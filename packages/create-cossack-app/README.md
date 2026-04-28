# Create Cossack App

This package provides a command-line interface (CLI) tool for creating new Cossack applications. It sets up a new project with the necessary dependencies and configuration to get you started quickly with the Cossack Framework.

## Usage
To create a new Cossack application, run the following command:

```sh
npx create-cossack-app@latest my-app
```

This will prompt you to choose the run-time environment for your application (Cloudflare Workers or Node.js) and set up the project accordingly. You can always change it later by modifying the `package.json` and installing the appropriate adapter package.

This will create a new directory called `my-app` with a basic Cossack application structure. You can then navigate into the directory and start the development server:

```sh
cd my-app
pnpm install
pnpm run dev
```