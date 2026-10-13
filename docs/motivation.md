---
title: "Motivation"
description: "Why Cossack exists: to solve the limitations of current frameworks by providing a unified syntax for frontend and backend code."
---

# Motivation

## Why This Project Exists

I started my career as a PHP developer. I used Laravel for a long time, and it was a great experience. The web then became more interactive. I found myself writing a lot of boilerplate to handle the frontend and the backend separately with Laravel and Angular, React, or Vue. Laravel acted only as an API server.

This led me to NestJS and Angular. Both sides then use the same language. This approach works well. I still write two separate applications, one for the frontend and one for the backend. The communication between them takes time.

Performance also matters in modern web development. The usual answer is to tweak the code and the server. But a centralized server has limits. All requests arrive at one server in one physical location. This is where the edge comes in. We can deploy the application to many locations around the world, close to every user. Most frameworks are not built for the edge, or they are not fully compatible with modern platforms like Cloudflare Workers.

I started to think about a framework that solves these problems. That is how this project was born.

## Why Is This Project Different

### Performance

An edge-first approach deploys the application to many locations around the world, close to the users. The requests are handled there. Users get better performance and lower latency.

### Ergonomic

The API is simple and intuitive. All frontend and backend code lives in the same class. Frontend code calls backend code directly. You do not write API routes or handle communication between the two sides.

### Enterprise Ready

I worked at a unicorn startup for a long time. I know what enterprise applications need. Cossack provides middlewares, dependency injection, and other features that enterprise applications require.

### LLM Friendly

Cossack code is compact. You write more functionality with less code, so you use fewer tokens. This matters when you use LLMs to generate code. It reduces the cost of using LLMs and makes them accessible to more people.
