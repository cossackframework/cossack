# Plan - Localization Support

## Overview
Up until now, our framework didn't have support for localization. Let's add it.

## Plan
- By default, use English as the default language.
- The `create-cossack-app` ship without `src/lang` folder.
- The framework use `APP_LOCALE` environment variable to determine the default language, defaulting to `en` if not set.

### Adding multi-language support

Users use `npx cossack lang publish` to generate a `src/lang` folder with the default `en.json` file, so let's add that command to the `cossack` CLI.

### Runtime locale switching

Users want to ability to switch the locale at runtime, so we need to add a `setLocale` function to the framework.


    setLocale(locale: string): Promise<void>

Also, please have an option to detect user's locale and set it automatically via browser or via country (cloudflare expose `cf` headers) if needed. YOU determine if those are practical or not. Here are my suggestions:

Example
```
setLocale('AUTO:BROWSER')
```

Or
```
setLocale('AUTO:LOCATION')
```


### Determine the current locale

```
getLocale(): string
```

OR

```
isLocale(locale: string): boolean
```

### Translation File Format
The translation files will be JSON files with key-value pairs. For example, `en.json`
```json
{
    "greeting": "Hello",
    "farewell": "Goodbye"
}
```

#### Using Translation Strings as Keys

For applications with a large number of translatable strings, defining every string with a "short key" can become confusing when referencing the keys in your views and it is cumbersome to continually invent keys for every translation string supported by your application.

For this reason, lets support for defining translation strings using the "default" translation of the string as the key. Language files that use translation strings as keys are stored as JSON files in the lang directory. For example, if your application has a Spanish translation, you should create a lang/es.json file:
```
{
    "I love programming.": "Me encanta programar."
}
```

### Retrieving Translation Strings

How about we add `__` function to retrieve translation strings? For example, `__('greeting')` would return "Hello" in English and "Hola" in Spanish. Or do you have any better idea?

```ts
render() {
    return html`
        <h1>${__('messages.welcome')}</h1>
    `;
}
```

If the specified translation string does not exist, the __ function will return the translation string key. So, using the example above, the __ function would return messages.welcome if the translation string does not exist.

If users are using default translation strings as their translation keys, they should pass the default translation of their string to the __ function;

```ts
render() {
    return html`
        <h1>${__('I love programming.')}</h1>
    `;
}
```

#### Replacing Parameters in Translation Strings

If they wish, they may define placeholders in their translation strings. All placeholders are prefixed with a `:`. For example, they may define a welcome message with a placeholder name:

```json
{
    "welcome": "Welcome, :name"
}
```

To replace the placeholders when retrieving a translation string, you may pass an array of replacements as the second argument to the __ function:

```ts
render() {
    return html`
        <h1>${__('welcome', { name: 'John' })}</h1>
    `;
}
```

If placeholder contains all capital letters, or only has its first letter capitalized, the translated value will be capitalized accordingly.

```
'welcome' => 'Welcome, :NAME', // Welcome, DAYLE
'goodbye' => 'Goodbye, :Name', // Goodbye, Dayle
```

### Pluralization

```json
{
    "apples": "You have :count apple|You have :count apples"
}
```

We support pluralization in translation strings. The `__` function will automatically determine which translation string to use based on the value of the `count` parameter.

```ts
render() {
    return html`
        <h1>${__('apples', { count: 1 })}</h1>
        <h1>${__('apples', { count: 5 })}</h1>
    `;
}
```

Of course, we should support pluralization in languages other than English. For example, in Russian, the pluralization rules are more complex. We can use the `Intl.PluralRules` API to determine the correct plural form based on the locale.

We need to support using translation strings as keys as well as using default translation strings as keys. For example, if the translation string is "You have :count apple|You have :count apples", we should be able to use it as a key in the translation file:

```json
{
    "You have :count apple|You have :count apples": "У вас :count яблоко|У вас :count яблока|У вас :count яблок"
}
```

```ts
render() {
    return html`
        <h1>${__('You have :count apple|You have :count apples', { count: 1 })}</h1>
        <h1>${__('You have :count apple|You have :count apples', { count: 5 })}</h1>
    `;
}
```

## Recap

Above is my plan for adding localization support to our framework based on how Laravel handles localization. Please let me know if you have any suggestions or improvements. Check other frameworks like Next.js, Nuxt.js, and Angular for inspiration.

Don't forget to add tests, documentation, demo, and test existing unit tests, e2e tests to make sure nothing is broken.