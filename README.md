# Tavern-Helper

> [!Warning]

> Executing custom JavaScript code may pose security risks:

>
> - Malicious scripts may steal your API keys, chat logs, and other sensitive information; modify or corrupt your SillyTavern settings.

> - Some scripts may perform dangerous operations, such as sending unauthorized requests.

>
> Before executing any script:

>
> 1. Carefully examine the script content to ensure its source is trustworthy.

> 2. Understand the script's function and potential impact.

> 3. If in doubt, do not execute scripts from unknown sources.

>
> We are not responsible for any losses caused by third-party scripts.


This extension allows you to run external JavaScript code within SillyTavern.

Since SillyTavern does not support direct JavaScript execution by default, this extension uses iframes to isolate and execute scripts, allowing you to run external scripts in certain restricted contexts.

## Documentation

- [Documentation](https://n0vi028.github.io/JS-Slash-Runner-Doc/)

## Contribution Tips

### Project Structure

Due to the project structure requirements of the Tavern UI plugin, this project directly packages the source code into the `dist/` folder and uploads it with the repository. This often leads to branch conflicts during development.

To solve this, the repository is configured in `.gitattribute` to always use the current version for conflicts in the `dist/` folder. This won't cause any problems: after uploading, CI will repackage the `dist/` folder with the latest version, so the contents of your uploaded `dist/` folder are irrelevant.

To enable this feature, execute the following command once:

```bash
git config --global merge.ours.driver true

```

### Manual Compilation

You can refer to [VSCode for participating in front-end plugin development] See [Environment Setup](https://sillytavern-stage-girls-dog.readthedocs.io/tool_and_experience/js_slash_runner/index.html) for more detailed configuration and usage tutorials on VSCode.

You need to have Node.js 22+ and pnpm installed. If you already have Node.js 22+ installed, you can install pnpm as follows:

``bash
npm install -g pnpm

```
Then, install all dependencies for this project using pnpm:

``bash
pnpm install
```
After that, you can compile this project:

``bash
pnpm build
```
Alternatively, you can use `pnpm watch` to continuously monitor code changes. This way, simply refreshing the Tavern website will update the Tavern with the latest plugin code.

## License

- [Aladdin](LICENSE)

## References

See the corresponding section in the [Documentation](https://n0vi028.github.io/JS-Slash-Runner-Doc/).
