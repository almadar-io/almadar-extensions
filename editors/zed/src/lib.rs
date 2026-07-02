use std::{collections::HashSet, env, path::PathBuf};
use zed_extension_api::{self as zed, Result};

const PACKAGE_NAME: &str = "@almadar/orb-lsp";

struct OrbExtension {
    installed: HashSet<String>,
}

fn get_package_path(package_name: &str) -> Result<PathBuf> {
    let path = env::current_dir()
        .map_err(|e| e.to_string())?
        .join("node_modules")
        .join(package_name);
    Ok(path)
}

impl OrbExtension {
    // Installs (or updates) @almadar/orb-lsp into this extension's own
    // sandboxed node_modules/ — the standard Zed npm-language-server
    // distribution pattern (WASM extensions can't bundle Node code directly,
    // so it's fetched at activation time; see e.g. zed-extensions/svelte).
    fn install_package_if_needed(&mut self, id: &zed::LanguageServerId) -> Result<()> {
        let installed_version = zed::npm_package_installed_version(PACKAGE_NAME)?;

        if installed_version.is_some() && self.installed.contains(PACKAGE_NAME) {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let latest_version = zed::npm_package_latest_version(PACKAGE_NAME)?;

        if installed_version.as_ref() != Some(&latest_version) {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );

            if let Err(error) = zed::npm_install_package(PACKAGE_NAME, &latest_version) {
                // Installation failed — reuse whatever's already installed rather
                // than hard-erroring, unless nothing is installed at all.
                if installed_version.is_none() {
                    Err(error)?;
                }
            }
        }

        self.installed.insert(PACKAGE_NAME.into());
        Ok(())
    }
}

impl zed::Extension for OrbExtension {
    fn new() -> Self {
        OrbExtension {
            installed: HashSet::new(),
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        self.install_package_if_needed(language_server_id)?;

        let server_path = get_package_path(PACKAGE_NAME)?
            .join("bin/orb-lsp.js")
            .to_string_lossy()
            .to_string();

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                "--experimental-vm-modules".to_string(),
                server_path,
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(OrbExtension);
