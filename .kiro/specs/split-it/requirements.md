# Requirements Document

## Introduction

Split-It is a lean MVP Progressive Web Application (PWA) that enables a small friend group to manage shared expenses. Users can create groups, log expenses with equal splits, track running balances, settle debts, and receive push notification reminders. The app uses Google-only authentication via Firebase Auth, is installable as a PWA, supports Web Share Target API for receiving shared screenshots, and provides basic offline support through a service worker with cache-first strategy for static assets.

## Glossary

- **App**: The Split-It Progressive Web Application built with Next.js App Router and TypeScript
