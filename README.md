# CDN Forwarder

A simple CDN forwarder for Kastel, fetches stuff from the backend, which returns a pre-signed S3 URL, and then "forwards" the request to that so we never have to expose the s3 bucket or pre-signed urls to the client / public.

This Depends on [The CDN](https://github.com/KastelApp/CDN)w

## Usage

idk just set it up on [cloudflare workers](https://workers.dev) lol.

## License

GPL-3.0
