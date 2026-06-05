# Motivation

## Why This Project Exists

I started my career as PHP developer, I've been working with Laravel for quite a long time and it's been a great experience. However, as the web evolved, I write a simple web application with Laravel and Angular/React/Vue, I found myself writing a lot of boilerplate code to handle the frontend and backend separately.

This led me to move to NestJS, so I can write both the frontend and backend in the same language. Their approach is good, however, I still need to write two separate applications, one for the frontend and one for the backend, and I still need to handle the communication between them.

One important thing to consider in modern web development nowadays is the performance. Yes, we can tweak our code and server to make it faster, however, we still hit the limits of "centralized" servers, where all the requests are handled by a single server. This is where the concept of "edge" comes in, where we can deploy our application to multiple locations around the world, closer to our users, and handle the requests there. This is where I found out about Next.js and Qwik, they are both great frameworks that allow us to write both the frontend and backend in the same application, and deploy it to the edge.

However, they both have a few limitations:

- For Next.js, they are quite vendor locked. I mean we have to either deploy on Vercel or host with Node servers.
- For Qwik, there are many quirks in version 1 that make it hard to develop and deploy to Cloudflare Workers. At the time of writing this, the only way to deploy is using Cloudflare Pages.

And, the most important thing is: "How we can make it further optimized for DX and performance?"

This is where I started to think about building a framework that can solve these problems, and that's how this project was born. 

## Why This Project Is Different

### Developer Experience

We make it further optimized for DX by providing a simple and intuitive API. All the frontend and backend code lives in the same class. Frontend code can call backend code directly, without the need to write any API routes or handle any communication between them. 

### Performance

Edge-first approach, we can deploy our application to multiple locations around the world, closer to our users, and handle the requests there. This allows us to achieve better performance and lower latency for our users.

### LLM Friendly

Less tokens, we can write more functionality with less code, which means we can achieve more with less tokens. This is especially important when we want to use LLMs to generate code for us, as it can help us to reduce the cost of using LLMs and make it more accessible for everyone.