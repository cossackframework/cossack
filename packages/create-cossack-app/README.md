# Create Cossack App

This package provides a command-line interface (CLI) tool for creating new Cossack applications. It sets up a new project with the necessary dependencies and configuration to get you started quickly with the Cossack Framework.

## Usage

To create a new Cossack application, run the following command:

```sh
npx create-cossack-app@latest my-app
```

This compatibility CLI delegates to `@cossackframework/scaffold`, the same
recipe engine used by `cossack create`.

This will create a new directory called `my-app` with a basic Cossack application structure. You can then navigate into the directory and start the development server:

```sh
cd my-app
pnpm install
pnpm run dev
```

## Presets and options

Full Stack remains the interactive and programmatic default. Available presets:

- `minimal`
- `database`
- `auth`
- `full-stack`

```sh
npx create-cossack-app my-app \
  --adapter=cloudflare \
  --preset=minimal \
  --features=auth \
  --database=d1 \
  --oauth=github,google \
  --theme=blue \
  --yes
```

Projects record their resolved recipe and owned file hashes in
`.cossack/scaffold.json`. Add capabilities later with `cossack add`.
