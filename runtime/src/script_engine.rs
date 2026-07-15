use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use starlark::environment::{FrozenModule, Globals, GlobalsBuilder, LibraryExtension, Module};
use starlark::eval::{Evaluator, ReturnFileLoader};
use starlark::starlark_module;
use starlark::syntax::{AstModule, Dialect};
use starlark::values::dict::{DictMut, DictRef};
use starlark::values::list::{AllocList, ListRef};
use starlark::values::list_or_tuple::UnpackListOrTuple;
use starlark::values::{Heap, Value};
use starlark::PrintHandler;
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};

const DEFAULT_TIMEOUT_MS: u64 = 1_200;
const MIN_TIMEOUT_MS: u64 = 100;
const MAX_TIMEOUT_MS: u64 = 10_000;
const MAX_TICK_COUNT: u64 = 2_000_000;
const MAX_HEAP_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarlarkRunRequest {
    pub path: String,
    pub function_name: String,
    #[serde(default)]
    pub args: Vec<JsonValue>,
    pub scripts: BTreeMap<String, String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarlarkRunResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<JsonValue>,
    #[serde(default)]
    pub prints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl StarlarkRunResponse {
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            value: None,
            prints: Vec::new(),
            error: Some(message.into()),
        }
    }
}

fn default_timeout_ms() -> u64 {
    DEFAULT_TIMEOUT_MS
}

#[starlark_module]
fn random_globals(builder: &mut GlobalsBuilder) {
    /// Return a uniformly distributed float in the half-open interval [0, 1).
    fn random() -> anyhow::Result<f64> {
        Ok(fastrand::f64())
    }

    /// Return a uniformly distributed integer including both endpoints.
    fn randint(start: i64, end: i64) -> anyhow::Result<i64> {
        if start > end {
            return Err(anyhow!("randint(): start は end 以下にしてください"));
        }
        Ok(fastrand::i64(start..=end))
    }

    /// Select one item from a non-empty list or tuple.
    fn choice<'v>(items: UnpackListOrTuple<Value<'v>>) -> anyhow::Result<Value<'v>> {
        if items.items.is_empty() {
            return Err(anyhow!("choice(): 空の配列からは選択できません"));
        }
        Ok(items.items[fastrand::usize(..items.items.len())])
    }

    /// Return a newly shuffled list without mutating the input list or tuple.
    fn shuffled<'v>(items: UnpackListOrTuple<Value<'v>>) -> anyhow::Result<Vec<Value<'v>>> {
        let mut values = items.items;
        fastrand::shuffle(&mut values);
        Ok(values)
    }
}

struct CollectedPrints<'a>(&'a RefCell<Vec<String>>);

impl PrintHandler for CollectedPrints<'_> {
    fn println(&self, text: &str) -> starlark::Result<()> {
        self.0.borrow_mut().push(text.to_owned());
        Ok(())
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone)]
struct Deadline(std::time::Instant);

#[cfg(not(target_arch = "wasm32"))]
impl Deadline {
    fn after(timeout_ms: u64) -> Self {
        Self(std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms))
    }

    fn expired(&self) -> bool {
        std::time::Instant::now() >= self.0
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone)]
struct Deadline(f64);

#[cfg(target_arch = "wasm32")]
impl Deadline {
    fn after(timeout_ms: u64) -> Self {
        Self(js_sys::Date::now() + timeout_ms as f64)
    }

    fn expired(&self) -> bool {
        js_sys::Date::now() >= self.0
    }
}

fn configure_evaluator<'v, 'a>(
    evaluator: &mut Evaluator<'v, 'a, '_>,
    deadline: &'a Deadline,
    print_handler: &'a CollectedPrints<'a>,
) -> Result<()> {
    evaluator.set_print_handler(print_handler);
    evaluator.set_max_tick_count(MAX_TICK_COUNT)?;
    evaluator.set_max_heap_size(MAX_HEAP_BYTES)?;
    evaluator.set_check_cancelled(Box::new(move || deadline.expired()));
    Ok(())
}

fn normalize_path(path: &str) -> String {
    let mut parts = Vec::new();
    let normalized = path.replace('\\', "/");
    for part in normalized.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn parent_path(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn resolve_load_path(
    current_path: &str,
    requested_path: &str,
    scripts: &BTreeMap<String, String>,
) -> Result<String> {
    let exact = normalize_path(requested_path);
    if scripts.contains_key(&exact) {
        return Ok(exact);
    }
    let parent = parent_path(current_path);
    let relative = normalize_path(&format!("{parent}/{requested_path}"));
    scripts
        .contains_key(&relative)
        .then_some(relative)
        .ok_or_else(|| anyhow!("load先が見つかりません: {requested_path}"))
}

fn parse_module(path: &str, scripts: &BTreeMap<String, String>) -> Result<AstModule> {
    let source = scripts
        .get(path)
        .ok_or_else(|| anyhow!("スクリプトが見つかりません: {path}"))?;
    AstModule::parse(path, source.clone(), &Dialect::Standard)
        .map_err(|error| anyhow!("{error:#}"))
        .with_context(|| format!("{path} を解析できません"))
}

fn compile_loaded_module(
    path: &str,
    scripts: &BTreeMap<String, String>,
    globals: &Globals,
    deadline: &Deadline,
    print_handler: &CollectedPrints<'_>,
    stack: &mut HashSet<String>,
) -> Result<FrozenModule> {
    if !stack.insert(path.to_owned()) {
        return Err(anyhow!("loadの循環を検出しました: {path}"));
    }

    let result = (|| {
        let ast = parse_module(path, scripts)?;
        let loaded = compile_loads(path, &ast, scripts, globals, deadline, print_handler, stack)?;
        Module::with_temp_heap(|module| {
            {
                let references = loaded
                    .iter()
                    .map(|(name, module)| (name.as_str(), module))
                    .collect::<HashMap<_, _>>();
                let loader = ReturnFileLoader {
                    modules: &references,
                };
                let mut evaluator = Evaluator::new(&module);
                configure_evaluator(&mut evaluator, deadline, print_handler)?;
                evaluator.set_loader(&loader);
                evaluator
                    .eval_module(ast, globals)
                    .map_err(|error| anyhow!("{error:#}"))?;
            }
            module.freeze().map_err(anyhow::Error::from)
        })
    })();

    stack.remove(path);
    result
}

fn compile_loads(
    current_path: &str,
    ast: &AstModule,
    scripts: &BTreeMap<String, String>,
    globals: &Globals,
    deadline: &Deadline,
    print_handler: &CollectedPrints<'_>,
    stack: &mut HashSet<String>,
) -> Result<HashMap<String, FrozenModule>> {
    let mut loaded = HashMap::new();
    for load in ast.loads() {
        let requested = load.module_id;
        let resolved = resolve_load_path(current_path, requested, scripts)?;
        let module =
            compile_loaded_module(&resolved, scripts, globals, deadline, print_handler, stack)?;
        loaded.insert(requested.to_owned(), module);
    }
    Ok(loaded)
}

fn add_current_history<'v>(context_value: Value<'v>, heap: Heap<'v>) -> Result<()> {
    let Some(context) = DictRef::from_value(context_value) else {
        return Ok(());
    };
    let Some(run_id) = context.get_str("runId").and_then(Value::unpack_str) else {
        return Ok(());
    };
    let Some(history_value) = context.get_str("history") else {
        return Ok(());
    };
    let run_id = run_id.to_owned();
    drop(context);

    let Some(history) = ListRef::from_value(history_value) else {
        return Ok(());
    };
    let current_history = heap.alloc(AllocList(history.iter().filter(|entry| {
        DictRef::from_value(*entry)
            .and_then(|entry| entry.get_str("runId"))
            .and_then(Value::unpack_str)
            == Some(run_id.as_str())
    })));
    let key = heap.alloc("currentHistory");
    let key = key.get_hashed().map_err(|error| anyhow!("{error:#}"))?;
    DictMut::from_value(context_value)?
        .aref
        .insert_hashed(key, current_history);
    Ok(())
}

fn execute(request: &StarlarkRunRequest, prints: &RefCell<Vec<String>>) -> Result<JsonValue> {
    let timeout_ms = request.timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    let deadline = Deadline::after(timeout_ms);
    let print_handler = CollectedPrints(prints);
    let globals = GlobalsBuilder::extended_by(&[LibraryExtension::Print])
        .with(random_globals)
        .build();
    let path = normalize_path(&request.path);
    let scripts = request
        .scripts
        .iter()
        .map(|(path, source)| (normalize_path(path), source.clone()))
        .collect::<BTreeMap<_, _>>();
    let ast = parse_module(&path, &scripts)?;
    let loaded = compile_loads(
        &path,
        &ast,
        &scripts,
        &globals,
        &deadline,
        &print_handler,
        &mut HashSet::from([path.clone()]),
    )?;

    let result = Module::with_temp_heap(|module| {
        let references = loaded
            .iter()
            .map(|(name, module)| (name.as_str(), module))
            .collect::<HashMap<_, _>>();
        let loader = ReturnFileLoader {
            modules: &references,
        };
        let mut evaluator = Evaluator::new(&module);
        configure_evaluator(&mut evaluator, &deadline, &print_handler)?;
        evaluator.set_loader(&loader);
        evaluator
            .eval_module(ast, &globals)
            .map_err(|error| anyhow!("{error:#}"))?;
        let function = module.get(&request.function_name).ok_or_else(|| {
            anyhow!(
                "{} に {}() がありません",
                request.path,
                request.function_name
            )
        })?;
        let arguments = request
            .args
            .iter()
            .map(|argument| {
                let value = module.heap().alloc(argument);
                add_current_history(value, module.heap())?;
                Ok(value)
            })
            .collect::<Result<Vec<_>>>()?;
        let value = evaluator
            .eval_function(function, &arguments, &[])
            .map_err(|error| anyhow!("{error:#}"))?;
        value
            .to_json_value()
            .context("Starlarkの戻り値はJSON互換である必要があります")
    });

    if deadline.expired() {
        Err(anyhow!(
            "Starlarkの実行が{timeout_ms}msを超えたため停止しました"
        ))
    } else {
        result
    }
}

pub fn run_starlark(request: &StarlarkRunRequest) -> StarlarkRunResponse {
    let prints = RefCell::new(Vec::new());
    let result = execute(request, &prints);
    let prints = prints.into_inner();
    match result {
        Ok(value) => StarlarkRunResponse {
            value: Some(value),
            prints,
            error: None,
        },
        Err(error) => StarlarkRunResponse {
            value: None,
            prints,
            error: Some(format!("{error:#}")),
        },
    }
}

pub fn run_starlark_json(input: &str) -> String {
    let response = match serde_json::from_str::<StarlarkRunRequest>(input) {
        Ok(request) => run_starlark(&request),
        Err(error) => {
            StarlarkRunResponse::error(format!("実行リクエストを解析できません: {error}"))
        }
    };
    serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(r#"{{"prints":[],"error":"実行結果を生成できません: {error}"}}"#)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(source: &str, args: Vec<JsonValue>) -> StarlarkRunRequest {
        StarlarkRunRequest {
            path: "scripts/route.star".to_owned(),
            function_name: "jump".to_owned(),
            args,
            scripts: BTreeMap::from([("scripts/route.star".to_owned(), source.to_owned())]),
            timeout_ms: DEFAULT_TIMEOUT_MS,
        }
    }

    #[test]
    fn executes_with_json_compatible_context_and_result() {
        let response = run_starlark(&request(
            "def jump(ctx):\n    return {'target': ctx['target'], 'values': [1, True, None]}\n",
            vec![json!({"target": "ending"})],
        ));
        assert_eq!(
            response.value,
            Some(json!({"target": "ending", "values": [1, true, null]}))
        );
        assert_eq!(response.error, None);
    }

    #[test]
    fn adds_current_history_as_references_to_entries_from_the_selected_run() {
        let response = run_starlark(&request(
            "def jump(ctx):\n    ctx['currentHistory'][0]['nodeId'] = 'changed'\n    return {\n        'ids': [entry['id'] for entry in ctx['currentHistory']],\n        'historyNode': ctx['history'][0]['nodeId'],\n    }\n",
            vec![json!({
                "runId": "run-a",
                "history": [
                    {"id": "a-1", "runId": "run-a", "nodeId": "original"},
                    {"id": "b-1", "runId": "run-b", "nodeId": "other"},
                    {"id": "a-2", "runId": "run-a", "nodeId": "ending"}
                ]
            })],
        ));
        assert_eq!(
            response.value,
            Some(json!({"ids": ["a-1", "a-2"], "historyNode": "changed"}))
        );
        assert_eq!(response.error, None);
    }

    #[test]
    fn captures_print_output() {
        let response = run_starlark(&request(
            "def jump(ctx):\n    print('target', ctx['target'])\n    return ctx['target']\n",
            vec![json!({"target": "ending"})],
        ));
        assert_eq!(response.value, Some(json!("ending")));
        assert_eq!(response.prints, vec!["target ending"]);
    }

    #[test]
    fn loads_relative_modules() {
        let mut value = request(
            "load('helpers.star', 'choose')\ndef jump(ctx):\n    return choose(ctx)\n",
            vec![json!({"target": "ending"})],
        );
        value.scripts.insert(
            "scripts/helpers.star".to_owned(),
            "def choose(ctx):\n    return ctx['target']\n".to_owned(),
        );
        let response = run_starlark(&value);
        assert_eq!(response.value, Some(json!("ending")), "{response:?}");
    }

    #[test]
    fn rejects_non_json_results() {
        let response = run_starlark(&request(
            "def jump(ctx):\n    return range(3)\n",
            vec![json!({})],
        ));
        assert!(response.value.is_none());
        assert!(response.error.unwrap().contains("JSON互換"));
    }

    #[test]
    fn stops_runaway_scripts() {
        let mut value = request(
            "def jump(ctx):\n    for _ in range(1000000000):\n        pass\n    return None\n",
            vec![json!({})],
        );
        value.timeout_ms = 100;
        let response = run_starlark(&value);
        assert!(response.value.is_none());
        let error = response.error.unwrap();
        assert!(error.contains("100ms") || error.contains("tick"), "{error}");
    }

    #[test]
    fn provides_random_helpers() {
        let response = run_starlark(&request(
            "def jump(ctx):\n    return {'random': random(), 'int': randint(2, 2), 'choice': choice(['a']), 'shuffled': shuffled([1, 2, 3])}\n",
            vec![json!({})],
        ));
        let value = response.value.expect("random helpers should execute");
        let random = value["random"].as_f64().unwrap();
        assert!((0.0..1.0).contains(&random));
        assert_eq!(value["int"], json!(2));
        assert_eq!(value["choice"], json!("a"));
        let mut shuffled = value["shuffled"].as_array().unwrap().clone();
        shuffled.sort_by_key(|value| value.as_i64());
        assert_eq!(shuffled, vec![json!(1), json!(2), json!(3)]);
    }

    #[test]
    fn random_helpers_reject_invalid_ranges_and_empty_choices() {
        let range = run_starlark(&request(
            "def jump(ctx):\n    return randint(3, 2)\n",
            vec![json!({})],
        ));
        assert!(range.error.unwrap().contains("start"));

        let empty = run_starlark(&request(
            "def jump(ctx):\n    return choice([])\n",
            vec![json!({})],
        ));
        assert!(empty.error.unwrap().contains("空"));
    }
}
