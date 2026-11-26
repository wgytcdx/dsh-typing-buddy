# DSH Activity Avatar

[简体中文](README.md) · [Download v0.2.0](https://github.com/wgytcdx/dsh-typing-buddy/releases/tag/v0.2.0) · [MIT License](LICENSE)

A floating avatar for the DeepSeek Harness web interface. It follows session, tool, and background activity and shows the current status below a customizable name. Click it for recent activity or right-click to open appearance settings.

![Activity avatar and recent activity panel in DSH](docs/market/activity.png)

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

See the [configuration reference](docs/reference.md), [test coverage](docs/acceptance.md), or [report an issue](https://github.com/wgytcdx/dsh-typing-buddy/issues).

## License

[MIT](LICENSE).
