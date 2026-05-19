# Feat - Controller & Dependency Injection

## Overview

Currently, we all of our components are just classes that extend `Cossack` and are decorated with `@Page()`. This is a great starting point, but as our applications grow, we may want to introduce more structure and organization to our code.

We want somehow to be able to separate our business logic from our rendering logic, and also to be able to reuse code across different components. This is where the concept of a "controller" comes in. Or, more generally, the concept of "dependency injection" (DI).

## Proposed API

The idea is to allow components to declare dependencies in their constructor, and have those dependencies automatically injected by the framework. This would allow us to create "controller" classes that contain our business logic, and then inject those controllers into our components.

```typescript
@Page()
export default class Payment extends Cossack {
    constructor(private paymentService: PaymentService) {
        super();
    }

    render() {
        return html`
            <div>
                <h1>Payment Page</h1>
                <button @click=${() => this.paymentService.processPayment()}>Pay Now</button>
                <p>This page is rendered by the Payment component.</p>
            </div>
        `;
    }
}
```

In this example, we have a `Payment` component that depends on a `PaymentService`. The `PaymentService` is injected into the component's constructor, and we can use it in our render method to handle the payment logic.

```typescript
class PaymentService {
    processPayment() {
        // Logic to process payment
        console.log('Processing payment...');
    }
}
```

## Considerations

0. Implementation: How should we implement the dependency injection system? Should we use a third-party library, or should we build our own simple DI container?
1. Scope: Should we allow injection of any class, or only classes that are decorated with a specific decorator (e.g., `@Service()`)?
2. `@Server()` and `@Client()` methods: Should we allow these methods to be defined in the controller classes, or should they only be allowed in the component classes?
3. Lifecycle: How should the lifecycle of the injected dependencies be managed? Should they be singletons, or should a new instance be created for each component instance?
4. Error handling: How should we handle errors that occur during dependency injection (e.g., if a required dependency is missing)?

## Next Steps
- Plan the implementation details and API design for the controller and dependency injection system.
- Consider the trade-offs of different approaches and decide on a final design.
- Implement the feature, create an example under `framework` package, write docs, run unit tests, e2e tests.