use super::protocol::{BLOCK_SIZE, ContentId};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CACHE_FORMAT_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheMeta {
    format_version: u16,
    content_id: ContentId,
    size: u64,
    block_size: u32,
    received: Vec<u8>,
    last_access_ms: u64,
    verified: bool,
}

pub struct BlockCache {
    directory: PathBuf,
    maximum_bytes: u64,
}

impl BlockCache {
    pub fn new(directory: impl Into<PathBuf>, maximum_bytes: u64) -> Result<Self> {
        let directory = directory.into();
        fs::create_dir_all(&directory).context("P2Pキャッシュフォルダを作成できません")?;
        let cache = Self {
            directory,
            maximum_bytes: maximum_bytes.max(u64::from(BLOCK_SIZE) * 4),
        };
        cache.remove_orphans()?;
        Ok(cache)
    }

    pub fn read_block(
        &self,
        content_id: &ContentId,
        size: u64,
        block_index: u64,
    ) -> Result<Option<Vec<u8>>> {
        let mut meta = match self.read_meta(content_id)? {
            Some(value) if value.size == size && value.block_size == BLOCK_SIZE => value,
            Some(_) => {
                self.remove(content_id)?;
                return Ok(None);
            }
            None => return Ok(None),
        };
        if !bit(&meta.received, block_index) {
            return Ok(None);
        }
        let offset = block_index * u64::from(BLOCK_SIZE);
        if offset >= size {
            return Ok(None);
        }
        let length = usize::try_from((size - offset).min(u64::from(BLOCK_SIZE))).unwrap();
        let mut data = vec![0; length];
        let mut file = match File::open(self.data_path(content_id)) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.remove(content_id)?;
                return Ok(None);
            }
            Err(error) => return Err(error).context("P2Pキャッシュを開けません"),
        };
        file.seek(SeekFrom::Start(offset))?;
        if file.read_exact(&mut data).is_err() {
            self.remove(content_id)?;
            return Ok(None);
        }
        meta.last_access_ms = now_ms();
        self.write_meta(&meta)?;
        Ok(Some(data))
    }

    pub fn write_block(
        &self,
        content_id: &ContentId,
        size: u64,
        offset: u64,
        data: &[u8],
        protected: &HashSet<ContentId>,
    ) -> Result<()> {
        if size == 0 || !offset.is_multiple_of(u64::from(BLOCK_SIZE)) || offset >= size {
            bail!("キャッシュへ書き込むブロック位置が不正です");
        }
        let expected = usize::try_from((size - offset).min(u64::from(BLOCK_SIZE))).unwrap();
        if data.len() != expected {
            bail!("キャッシュへ書き込むブロック長が一致しません");
        }
        let blocks = size.div_ceil(u64::from(BLOCK_SIZE));
        let bit_bytes = usize::try_from(blocks.div_ceil(8)).context("ファイルが大きすぎます")?;
        let existing = self.read_meta(content_id)?;
        if existing.is_none() {
            self.prune(size, protected)?;
        }
        let mut meta = existing.unwrap_or_else(|| CacheMeta {
            format_version: CACHE_FORMAT_VERSION,
            content_id: *content_id,
            size,
            block_size: BLOCK_SIZE,
            received: vec![0; bit_bytes],
            last_access_ms: now_ms(),
            verified: false,
        });
        if meta.size != size || meta.received.len() != bit_bytes {
            self.remove(content_id)?;
            self.prune(size, protected)?;
            meta = CacheMeta {
                format_version: CACHE_FORMAT_VERSION,
                content_id: *content_id,
                size,
                block_size: BLOCK_SIZE,
                received: vec![0; bit_bytes],
                last_access_ms: now_ms(),
                verified: false,
            };
        }

        let path = self.data_path(content_id);
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .context("P2Pキャッシュデータを作成できません")?;
        if file.metadata()?.len() != size {
            file.set_len(size)
                .context("P2Pキャッシュサイズを設定できません")?;
        }
        file.seek(SeekFrom::Start(offset))?;
        file.write_all(data)
            .context("P2Pキャッシュへ書き込めません")?;
        file.sync_data()
            .context("P2Pキャッシュを永続化できません")?;
        set_bit(&mut meta.received, offset / u64::from(BLOCK_SIZE));
        meta.last_access_ms = now_ms();
        self.write_meta(&meta)?;

        if !meta.verified && all_bits(&meta.received, blocks) {
            let actual = hash_file(&path)?;
            if actual != *content_id {
                self.remove(content_id)?;
                bail!("受信ファイル全体のハッシュが一致しません");
            }
            meta.verified = true;
            self.write_meta(&meta)?;
        }
        Ok(())
    }

    pub fn remove(&self, content_id: &ContentId) -> Result<()> {
        remove_if_exists(&self.data_path(content_id))?;
        remove_if_exists(&self.meta_path(content_id))?;
        Ok(())
    }

    fn read_meta(&self, content_id: &ContentId) -> Result<Option<CacheMeta>> {
        let bytes = match fs::read(self.meta_path(content_id)) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("P2Pキャッシュメタデータを読めません"),
        };
        let meta: CacheMeta = match postcard::from_bytes(&bytes) {
            Ok(value) => value,
            Err(_) => {
                self.remove(content_id)?;
                return Ok(None);
            }
        };
        if meta.format_version != CACHE_FORMAT_VERSION
            || meta.content_id != *content_id
            || meta.block_size != BLOCK_SIZE
        {
            self.remove(content_id)?;
            return Ok(None);
        }
        Ok(Some(meta))
    }

    fn write_meta(&self, meta: &CacheMeta) -> Result<()> {
        let bytes = postcard::to_allocvec(meta).context("P2Pキャッシュ情報を作成できません")?;
        let target = self.meta_path(&meta.content_id);
        let temporary = target.with_extension(format!("meta.{}.tmp", fastrand::u64(..)));
        let result = (|| -> Result<()> {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .context("P2Pキャッシュ一時ファイルを作成できません")?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &target).context("P2Pキャッシュ情報を置換できません")?;
            Ok(())
        })();
        let _ = remove_if_exists(&temporary);
        result
    }

    fn prune(&self, incoming_size: u64, protected: &HashSet<ContentId>) -> Result<()> {
        let mut entries = self.entries()?;
        let mut used: u64 = entries.iter().map(|(_, meta)| meta.size).sum();
        if used.saturating_add(incoming_size) <= self.maximum_bytes {
            return Ok(());
        }
        entries.sort_by_key(|(_, meta)| Reverse(meta.last_access_ms));
        while used.saturating_add(incoming_size) > self.maximum_bytes {
            let Some((id, meta)) = entries.pop() else {
                break;
            };
            if protected.contains(&id) {
                continue;
            }
            self.remove(&id)?;
            used = used.saturating_sub(meta.size);
        }
        Ok(())
    }

    fn entries(&self) -> Result<Vec<(ContentId, CacheMeta)>> {
        let mut output = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Some(stem) = name.strip_suffix(".meta") else {
                continue;
            };
            let Some(id) = parse_hex_id(stem) else {
                let _ = remove_if_exists(&entry.path());
                continue;
            };
            if let Some(meta) = self.read_meta(&id)? {
                output.push((id, meta));
            }
        }
        Ok(output)
    }

    fn remove_orphans(&self) -> Result<()> {
        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.ends_with(".tmp") {
                let _ = remove_if_exists(&path);
                continue;
            }
            if let Some(stem) = name.strip_suffix(".data")
                && !self.directory.join(format!("{stem}.meta")).is_file()
            {
                let _ = remove_if_exists(&path);
            }
        }
        Ok(())
    }

    fn data_path(&self, content_id: &ContentId) -> PathBuf {
        self.directory.join(format!("{}.data", hex_id(content_id)))
    }

    fn meta_path(&self, content_id: &ContentId) -> PathBuf {
        self.directory.join(format!("{}.meta", hex_id(content_id)))
    }
}

fn bit(values: &[u8], index: u64) -> bool {
    let Ok(byte) = usize::try_from(index / 8) else {
        return false;
    };
    values
        .get(byte)
        .is_some_and(|value| value & (1 << (index % 8)) != 0)
}

fn set_bit(values: &mut [u8], index: u64) {
    if let Ok(byte) = usize::try_from(index / 8)
        && let Some(value) = values.get_mut(byte)
    {
        *value |= 1 << (index % 8);
    }
}

fn all_bits(values: &[u8], count: u64) -> bool {
    (0..count).all(|index| bit(values, index))
}

fn hash_file(path: &Path) -> Result<ContentId> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hash.finalize().into())
}

pub fn hex_id(id: &ContentId) -> String {
    id.iter().map(|value| format!("{value:02x}")).collect()
}

fn parse_hex_id(value: &str) -> Option<ContentId> {
    if value.len() != 64 {
        return None;
    }
    let mut output = [0u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(output)
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_cache_survives_reopen_and_verifies_when_complete() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = vec![5u8; BLOCK_SIZE as usize + 17];
        let id: ContentId = Sha256::digest(&bytes).into();
        let cache = BlockCache::new(directory.path(), 10 * 1024 * 1024).unwrap();
        cache
            .write_block(
                &id,
                bytes.len() as u64,
                0,
                &bytes[..BLOCK_SIZE as usize],
                &HashSet::new(),
            )
            .unwrap();
        drop(cache);

        let cache = BlockCache::new(directory.path(), 10 * 1024 * 1024).unwrap();
        assert_eq!(
            cache
                .read_block(&id, bytes.len() as u64, 0)
                .unwrap()
                .unwrap(),
            &bytes[..BLOCK_SIZE as usize]
        );
        cache
            .write_block(
                &id,
                bytes.len() as u64,
                u64::from(BLOCK_SIZE),
                &bytes[BLOCK_SIZE as usize..],
                &HashSet::new(),
            )
            .unwrap();
        assert!(cache.read_meta(&id).unwrap().unwrap().verified);
    }

    #[test]
    fn wrong_complete_hash_is_deleted() {
        let directory = tempfile::tempdir().unwrap();
        let cache = BlockCache::new(directory.path(), 1024 * 1024).unwrap();
        let data = vec![1u8; 32];
        assert!(
            cache
                .write_block(&[9u8; 32], 32, 0, &data, &HashSet::new())
                .is_err()
        );
        assert!(cache.read_meta(&[9u8; 32]).unwrap().is_none());
    }
}
