//! Cluster model and connection state.

use crate::kubeconfig::ContextInfo;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnState {
    Disconnected,
    Connecting,
    Connected,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cluster {
    pub id: String,
    pub context: String,
    pub server: String,
    pub state: ConnState,
}

impl Cluster {
    pub fn new(ctx: &ContextInfo) -> Self {
        Self {
            id: ctx.name.clone(),
            context: ctx.name.clone(),
            server: ctx.server.clone(),
            state: ConnState::Disconnected,
        }
    }

    pub fn mark(&mut self, s: ConnState) {
        self.state = s;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ContextInfo {
        ContextInfo {
            name: "kind-dev".into(),
            cluster: "kind-dev".into(),
            server: "https://x".into(),
            is_current: false,
        }
    }

    #[test]
    fn new_cluster_starts_disconnected() {
        let c = Cluster::new(&ctx());
        assert_eq!(c.state, ConnState::Disconnected);
        assert_eq!(c.id, "kind-dev");
        assert_eq!(c.server, "https://x");
    }

    #[test]
    fn mark_transitions_state() {
        let mut c = Cluster::new(&ctx());
        c.mark(ConnState::Connecting);
        assert_eq!(c.state, ConnState::Connecting);
        c.mark(ConnState::Connected);
        assert_eq!(c.state, ConnState::Connected);
    }
}
