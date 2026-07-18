import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://docs.yuraive.com',
  trailingSlash: 'always',
  build: {
    inlineStylesheets: 'never',
  },
  integrations: [
    starlight({
      title: 'Yuraive ドキュメント',
      description: 'Yuraiveのプレイヤーとエディタを使うための公式ドキュメントです。',
      logo: {
        src: './src/assets/icon.svg',
        alt: 'Yuraive',
      },
      favicon: '/favicon.svg',
      locales: {
        root: {
          label: '日本語',
          lang: 'ja',
        },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/h-sumiya/yuraive',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/h-sumiya/yuraive/edit/main/docs/',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: '目的から探す', slug: 'index' },
        {
          label: 'はじめる',
          items: [
            { label: 'Yuraiveを使い始める', slug: 'getting-started' },
            { label: 'Android版を使う', slug: 'getting-started/android' },
            { label: 'Windows版を使う', slug: 'getting-started/windows' },
          ],
        },
        {
          label: 'ライブラリと再生',
          items: [
            { label: 'コンテンツを追加する', slug: 'library/add-content' },
            { label: '作品を探して整理する', slug: 'library/find-and-organize' },
            { label: '作品を再生する', slug: 'player/play' },
            { label: '履歴と再生統計を見る', slug: 'player/history-and-stats' },
          ],
        },
        {
          label: 'エディタ',
          items: [
            { label: 'フォルダを開いて保存する', slug: 'editor/open-and-save' },
            { label: '素材を追加する', slug: 'editor/add-media' },
            { label: '再生の流れを作る', slug: 'editor/build-flow' },
            { label: 'ボタンと再生設定を作る', slug: 'editor/buttons-and-controls' },
            { label: 'プレビューと問題を確認する', slug: 'editor/preview-and-check' },
          ],
        },
        {
          label: '高度な制作',
          collapsed: true,
          items: [
            { label: 'コンテンツのファイルを管理する', slug: 'authoring/content-files' },
            { label: 'JSONを直接編集する', slug: 'authoring/json' },
            { label: 'ボタンレイアウトを作る', slug: 'authoring/layouts' },
            { label: 'Starlarkで分岐を作る', slug: 'authoring/starlark' },
            { label: 'プレイヤー用に配布する', slug: 'authoring/distribute' },
          ],
        },
        {
          label: 'トラブルシューティング',
          items: [
            { label: '読み込みと再生の問題', slug: 'troubleshooting/content' },
            { label: 'SMBとWebDAVの問題', slug: 'troubleshooting/remote-library' },
            { label: 'エディタの保存と表示の問題', slug: 'troubleshooting/editor' },
          ],
        },
        {
          label: 'Yuraive Editorを開く',
          link: 'https://editor.yuraive.com/',
          attrs: { target: '_blank', rel: 'noopener' },
        },
        {
          label: 'Yuraive公式サイト',
          link: 'https://yuraive.com/',
          attrs: { target: '_blank', rel: 'noopener' },
        },
      ],
    }),
  ],
})
