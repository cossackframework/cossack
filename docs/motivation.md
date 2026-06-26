---
title: "Motivation"
description: "Why Cossack exists: to solve the limitations of current frameworks by providing a unified syntax for frontend and backend code."
---

# Motivation

## Why This Project Exists

I started my career as PHP developer, I've been working with Laravel for quite a long time and it's been a great experience. However, as the web evolved, I found myself writing a lot of boilerplate code to handle the frontend and backend separately with Laravel and Angular/React/Vue.

This led me to move to NestJS + Angular so I can write both the frontend and backend in the same language. This approach is good. However, I still need to write two separate applications, one for the frontend and one for the backend, and handle the communication between them is time-consuming.

One important thing to consider in modern web development nowadays is the performance. Yes, we might say: "tweak our code and server to make it faster", however, we still hit the limits of "centralized" servers, where all the requests are handled by a single server. This is where the concept of "edge" comes in. We can deploy our application to multiple locations around the world, close to every users. This is where I found out about Next.js and Qwik, they are both great frameworks that allow us to write both the frontend and backend in the same application, then deploy it to the edge.

However, they still have a few limitations, either vendor-locked, not fully compatibility with modern platform like Cloudflare Workers.

This is where I started to think about building a framework that can solve these problems, and that's how this project was born. 

## Why This Project Is Different

### Developer Experience

We make it further optimized for DX by providing a simple and intuitive API. All the frontend and backend code lives in the same class. Frontend code can call backend code directly, without the need to write any API routes or handle any communication between them. 

### Performance

Edge-first approach, we can deploy our application to multiple locations around the world, closer to our users, and handle the requests there. This allows us to achieve better performance and lower latency for our users.

### LLM Friendly

Less tokens, we can write more functionality with less code, which means we can achieve more with less tokens. This is especially important when we want to use LLMs to generate code for us, as it can help us to reduce the cost of using LLMs and make it more accessible for everyone.