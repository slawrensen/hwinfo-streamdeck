---
title: Overview
nav_order: 1
description: Live HWiNFO temperatures, clocks, fan speeds and power on your Stream Deck. Install the Windows plugin and add your first reading.
---

<header class="home-intro">
  <h1>HWiNFO Sensors <span>for Stream Deck</span></h1>
  <p class="home-lead">Live temperatures, clocks, fan speeds and power from HWiNFO, right on your keys and dials.</p>
  <div class="home-actions">
    <a class="button button-primary" href="{{ site.plugin_release.download }}">Download {{ site.plugin_release.version }} <span aria-hidden="true">↓</span></a>
    <a class="button button-secondary" href="{{ '/getting-started.html' | relative_url }}">Get started <span aria-hidden="true">→</span></a>
  </div>
  <p class="home-requirements"><strong>Windows 10+ (x64)</strong> · Stream Deck 6.9+ · HWiNFO running locally.<br>Free HWiNFO limits Shared Memory to 12 hours. <a href="{{ '/installation.html' | relative_url }}">Requirements & installation</a></p>
</header>

<figure class="hero-figure">
  <a class="image-link" href="{{ '/assets/img/dial-backgrounds-deck.jpg' | relative_url }}" data-image-viewer aria-label="Open the complete deck image">
    <picture>
      <source media="(max-width: 600px)" type="image/webp" srcset="{{ '/assets/img/showcase/deck-detail.webp' | relative_url }}" width="422" height="406">
      <source media="(max-width: 600px)" srcset="{{ '/assets/img/showcase/deck-detail.jpg' | relative_url }}" width="422" height="406">
      <source type="image/webp" srcset="{{ '/assets/img/showcase/deck-640.webp' | relative_url }} 640w, {{ '/assets/img/showcase/deck-960.webp' | relative_url }} 960w, {{ '/assets/img/showcase/deck-1300.webp' | relative_url }} 1300w" sizes="(min-width: 1560px) 1140px, (min-width: 1000px) calc(100vw - 340px), calc(100vw - 48px)">
      <img src="{{ '/assets/img/dial-backgrounds-deck.jpg' | relative_url }}" width="1300" height="710" fetchpriority="high" alt="Live Midnight keys and six independent Tint dials over the Cosmic Cliffs in the Stream Deck app.">
    </picture>
    <span class="image-hint" aria-hidden="true">View complete image ↗</span>
  </a>
  <figcaption>Live Stream Deck app capture. Midnight keys and transparent Tint dials. <span class="image-credit">Cosmic Cliffs: NASA, ESA, CSA, STScI.</span></figcaption>
</figure>

<section class="home-showcase" aria-labelledby="what-it-does">
  <h2 id="what-it-does">Make it your display</h2>
  <div class="showcase-grid">
    <figure>
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/showcase/keys.png' | relative_url }}" aria-label="Enlarge key layout examples"><picture><source type="image/webp" srcset="{{ '/assets/img/showcase/keys-detail.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/keys-detail.png' | relative_url }}" width="288" height="288" loading="lazy" decoding="async" alt="A four-reading key with CPU and GPU temperatures, pump speed and power."></picture></a>
      <figcaption><h3><a href="{{ '/sensor-reading.html' | relative_url }}">Keys <span aria-hidden="true">→</span></a></h3><p>One to four readings per key.<br><span class="capture-type">Sample rendering.</span></p></figcaption>
    </figure>
    <figure>
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/showcase/dials.png' | relative_url }}" aria-label="Enlarge dial view examples"><picture><source type="image/webp" srcset="{{ '/assets/img/showcase/dials-detail.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/dials-detail.png' | relative_url }}" width="400" height="200" loading="lazy" decoding="async" alt="Two-row dial view with CPU and GPU readings and separate trend lines."></picture></a>
      <figcaption><h3><a href="{{ '/sensor-dial.html' | relative_url }}">Dials <span aria-hidden="true">→</span></a></h3><p>Readings, trends and local session stats.<br><span class="capture-type">Sample rendering. Stream Deck + / + XL.</span></p></figcaption>
    </figure>
    <figure>
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/dial-backgrounds-strip.jpg' | relative_url }}" aria-label="Enlarge transparent background examples"><picture><source type="image/webp" srcset="{{ '/assets/img/showcase/backgrounds-detail.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/backgrounds-detail.jpg' | relative_url }}" width="621" height="332" loading="lazy" decoding="async" alt="Separate dial slots over space, aurora and pale backgrounds in the Stream Deck app."></picture></a>
      <figcaption><h3><a href="{{ '/sensor-dial.html#transparent-background' | relative_url }}">Backgrounds <span aria-hidden="true">→</span></a></h3><p>Your touch strip picture, behind each dial.<br><span class="capture-type">App captures. Space imagery: NASA, ESA, CSA, STScI.</span></p></figcaption>
    </figure>
  </div>
</section>

<section class="home-paths" aria-labelledby="start-here">
  <h2 id="start-here">Find what you need</h2>
  <ul>
    <li><a href="{{ '/themes.html' | relative_url }}">Compare the seven themes <span aria-hidden="true">→</span></a><span>Pick a palette and set reading colors.</span></li>
    <li><a href="{{ '/data-sources.html' | relative_url }}">Understand your data source <span aria-hidden="true">→</span></a><span>Sharing, freshness, history and reading links.</span></li>
    <li><a href="{{ '/troubleshooting.html' | relative_url }}">Fix a status message <span aria-hidden="true">→</span></a><span>Find the exact message and the next step.</span></li>
  </ul>
  <p class="channel-note">GitHub: {{ site.plugin_release.package_version }}. Marketplace: {{ site.plugin_release.marketplace_version }} as checked {{ site.plugin_release.checked }}. <a href="{{ '/installation.html' | relative_url }}">Choose an install channel</a>.</p>
</section>
