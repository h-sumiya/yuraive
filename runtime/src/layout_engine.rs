//! Platform-neutral interpreter for the safe `.yuraive-layout.html` subset.
//!
//! The runtime intentionally produces geometry and appearance data only.  Android and Windows
//! turn that render model into native controls; no browser DOM or JavaScript is involved.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use taffy::geometry::Point;
use taffy::prelude::*;
use taffy::style::{
    GridAutoTracks, GridPlacement, GridTemplateArea, GridTemplateComponent, GridTemplateTracks,
    Overflow,
};
use unicode_width::UnicodeWidthStr;

include!("layout_engine/model.rs");
include!("layout_engine/parser.rs");
include!("layout_engine/taffy.rs");
include!("layout_engine/style.rs");
include!("layout_engine/length.rs");
include!("layout_engine/tests.rs");
