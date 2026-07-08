use std::collections::BTreeSet;

use catamaran_capability::Registry;

use crate::McpServer;

/// Returns Err(missing_ids) if any registered capability has no MCP tool.
pub fn assert_every_capability_has_a_tool(
    registry: &Registry,
    server: &McpServer,
) -> Result<(), Vec<String>> {
    // Bind the owned Vec so the &str borrows outlive the expression.
    let tools = server.list_tools();
    let tool_names: BTreeSet<&str> = tools.iter().map(|t| t.name.as_str()).collect();
    let missing: Vec<String> = registry
        .ids()
        .into_iter()
        .filter(|id| !tool_names.contains(id))
        .map(str::to_string)
        .collect();
    if missing.is_empty() { Ok(()) } else { Err(missing) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catamaran_capability::{Capability, Registry};
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn complete_registry_passes() {
        let mut reg = Registry::new();
        reg.register(Capability::read_only("a", "", |_| async { Ok(json!(null)) }));
        let server = McpServer::new(Arc::new(reg.clone()));
        assert_eq!(assert_every_capability_has_a_tool(&reg, &server), Ok(()));
    }

    #[test]
    fn detects_capability_with_no_tool() {
        // server built from an empty registry => "a" is missing a tool
        let mut reg = Registry::new();
        reg.register(Capability::read_only("a", "", |_| async { Ok(json!(null)) }));
        let empty = McpServer::new(Arc::new(Registry::new()));
        assert_eq!(
            assert_every_capability_has_a_tool(&reg, &empty),
            Err(vec!["a".to_string()])
        );
    }
}
