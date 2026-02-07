use zed_extension_api as zed;

struct OrbExtension;

impl zed::Extension for OrbExtension {
    fn new() -> Self {
        OrbExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        // Resolve `node` from the system PATH via the worktree
        let node_path = worktree
            .which("node")
            .ok_or_else(|| "node not found in PATH. Install Node.js to use orb-lsp.".to_string())?;

        // The server lives relative to the worktree root
        let worktree_root = worktree.root_path();
        let server_path = format!(
            "{}/packages/almadar-extensions/lsp/dist/server.js",
            worktree_root
        );

        Ok(zed::Command {
            command: node_path,
            args: vec!["--experimental-vm-modules".to_string(), server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(OrbExtension);
