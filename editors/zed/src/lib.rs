use zed_extension_api as zed;

struct OrbExtension;

impl zed::Extension for OrbExtension {
    fn new() -> Self {
        OrbExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        // Launch the Node.js LSP proxy via npx
        // The proxy wraps .orb content as TypeScript and provides diagnostics
        Ok(zed::Command {
            command: "npx".to_string(),
            args: vec!["@almadar/orb-lsp".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(OrbExtension);
