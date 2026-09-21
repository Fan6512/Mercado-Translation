# Translation Provider v2 validation

This branch keeps Google and Microsoft as vendor-level choices in the main UI while separating free and official transports in settings.

CI coverage lives in `verify-translation-provider-v2.yml` and validates routing, official authentication headers, Azure HTTPS enforcement, Google 429 cooldown behavior, and the five-tab settings layout. No real credentials or public network calls are used in CI.
