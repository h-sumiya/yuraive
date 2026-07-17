#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRequest {
    pub source: String,
    #[serde(default)]
    pub buttons: Vec<LayoutButton>,
    pub canvas: LayoutCanvas,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutCanvas {
    pub width: f32,
    pub height: f32,
    #[serde(default = "one")]
    pub density: f32,
    #[serde(default = "one")]
    pub font_scale: f32,
    #[serde(default)]
    pub safe_top: f32,
    #[serde(default)]
    pub safe_right: f32,
    #[serde(default)]
    pub safe_bottom: f32,
    #[serde(default)]
    pub safe_left: f32,
}

fn one() -> f32 {
    1.0
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutButton {
    pub id: String,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub target_slot: Option<String>,
    #[serde(default)]
    pub order: i32,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub style: ButtonInputStyle,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonInputStyle {
    pub background_color: Option<String>,
    pub background_image: Option<String>,
    pub text_color: Option<String>,
    pub opacity: Option<f32>,
    pub border_color: Option<String>,
    pub border_width: Option<f32>,
    pub border_radius: Option<f32>,
    pub font_size: Option<f32>,
    pub font_weight: Option<i32>,
    pub padding_horizontal: Option<f32>,
    pub padding_vertical: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutResponse {
    pub buttons: Vec<ResolvedButton>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedButton {
    pub id: String,
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub z_index: i32,
    pub enabled: bool,
    pub style: NativeButtonStyle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeButtonStyle {
    pub background_color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_image: Option<String>,
    pub background_size: String,
    pub background_position: String,
    pub background_repeat: String,
    pub text_color: String,
    pub opacity: f32,
    pub border_color: String,
    pub border_width: f32,
    pub border_radius: f32,
    pub font_size: f32,
    pub font_weight: i32,
    pub padding_left: f32,
    pub padding_top: f32,
    pub padding_right: f32,
    pub padding_bottom: f32,
    pub text_align: String,
    pub vertical_align: String,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub white_space: String,
    pub text_overflow: String,
    pub overflow: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub box_shadow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ElementKind {
    Root,
    Div,
    Slot,
    Button,
}

#[derive(Debug, Clone)]
struct Element {
    kind: ElementKind,
    attrs: BTreeMap<String, String>,
    classes: Vec<String>,
    parent: Option<usize>,
    children: Vec<usize>,
    button: Option<usize>,
    computed: BTreeMap<String, String>,
}

impl Element {
    fn new(kind: ElementKind, parent: Option<usize>) -> Self {
        Self {
            kind,
            attrs: BTreeMap::new(),
            classes: vec![],
            parent,
            children: vec![],
            button: None,
            computed: BTreeMap::new(),
        }
    }

    fn tag(&self) -> &'static str {
        match self.kind {
            ElementKind::Root => "yuraive-canvas",
            ElementKind::Div => "div",
            ElementKind::Slot => "slot",
            ElementKind::Button => "button",
        }
    }
}

#[derive(Debug, Clone)]
struct CssRule {
    selector: String,
    declarations: Vec<(String, String)>,
    specificity: (u16, u16, u16),
    order: usize,
}

#[derive(Debug, Clone)]
struct ButtonNodeContext {
    text: String,
    font_size: f32,
    line_height: f32,
    letter_spacing: f32,
    white_space: bool,
    stretch_width: bool,
}
