# DSH Activity Avatar

[简体中文](README.md) · [Download v0.2.0](https://github.com/wgytcdx/dsh-typing-buddy/releases/tag/v0.2.0) · [MIT License](LICENSE)

A floating avatar for the DeepSeek Harness web interface. It follows session, tool, and background activity and shows the current status below a customizable name. Click it for recent activity or right-click to open appearance settings.

![Activity avatar and recent activity panel in DSH](docs/market/activity.png)

## Gallery

| Idle | Creating | Waiting | Completed |
| :---: | :---: | :---: | :---: |
| <img src="docs/market/state-idle.png" width="150" alt="Idle avatar showing its name"> | <img src="docs/market/state-making.png" width="150" alt="Avatar showing document creation in progress"> | <img src="docs/market/state-waiting.png" width="150" alt="Avatar waiting for results"> | <img src="docs/market/state-done.png" width="150" alt="Completed state with a gold ring"> |

### macOS desktop overlay

<img src="docs/market/desktop-overlay.png" width="120" alt="macOS desktop overlay with the avatar, name, current activity, and close button">

The overlay can display the name and activity when the DSH window is hidden. It requires the separate macOS companion.

## Install

Tested with DSH `0.2.1-rc.2`. The package ID is `dsh-typing-buddy`.

- **Desktop** — In Plugins, choose Add Plugin and the GitHub source, then enter `wgytcdx/dsh-typing-buddy`. You can also extract the [prebuilt package](https://github.com/wgytcdx/dsh-typing-buddy/releases/download/v0.2.0/dsh-typing-buddy-0.2.0.tgz) and select the extracted `package` folder as a local directory.
- **Web** — With DSH CLI and Node.js 22, run:

```bash
dsh plugin --profile web add 'github:wgytcdx/dsh-typing-buddy#v0.2.0'
dsh --profile web
```

To remove the plugin, use its Uninstall action in Desktop or run `dsh plugin --profile web remove dsh-typing-buddy` for Web.

## Use

- Click the avatar to open the Activity, Appearance, and Avatar tabs. Drag it to move it.
- Change its name, size, caption padding, position, or theme in Appearance.
- Import an asset pack in the Avatar tab, preview it, and confirm activation. The built-in portrait is static. Imported videos play muted when available and fall back to a portrait otherwise.
- The optional Agnes API is disabled by default. Generation requests send the chosen prompt and reference to Agnes and may incur charges.

![Appearance settings in DSH](docs/market/appearance.png)

See the [configuration reference](docs/reference.md), [test coverage](docs/acceptance.md), or [report an issue](https://github.com/wgytcdx/dsh-typing-buddy/issues).

## License

[MIT](LICENSE).
