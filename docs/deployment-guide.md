# Deployment Guide

## Firebase hosting

1. Install the Firebase CLI and authenticate.
2. Create a Firebase project and enable Realtime Database and Hosting.
3. Deploy the site with:

```bash
firebase --config firebase/firebase.json deploy
```

## Security note

- Do not place Firebase service-account private keys in the frontend.
- Keep the gateway environment credentialed separately from public files.
- The website should never claim to directly talk to the HC-06 or Arduino from the browser.

## Operational note

The Python gateway must remain connected to the internet and the Bluetooth module for remote commands to work.
