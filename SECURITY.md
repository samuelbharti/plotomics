# Security Policy

## Supported versions

plotomics is released from a single tag across npm, PyPI and r-universe, and the
JavaScript, R and Python packages always share a version. Only the most recent
release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

Please report security issues privately rather than in a public issue.

Use GitHub's [private vulnerability
reporting](https://github.com/samuelbharti/plotomics/security/advisories/new) —
that keeps the report visible only to the maintainers until a fix is available.

Please include what the issue is, how to reproduce it, which package and version
you were using (npm, PyPI or r-universe), and what an attacker could achieve.

You should get an acknowledgement within a week. This is a small,
single-maintainer project, so please be patient with the fix timeline; if the
issue is being actively exploited, say so clearly and it will be prioritised.

## Scope

plotomics renders data you give it in a browser context. The most likely class of
issue is one where untrusted input — gene labels, sample names, tooltip content,
a Gosling or igv.js spec — reaches the DOM in a way that allows script injection.
Reports of that kind are in scope and welcome.

Vulnerabilities in the bundled upstream engines (igv.js, Gosling.js, sigma,
regl, PixiJS) are best reported to those projects directly. If you tell us about
one, we will track the upgrade here.
