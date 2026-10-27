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

{% assign gallery_sizes = '(min-width: 1680px) min(900px, calc(56.4vw - 180px)), (min-width: 1200px) min(960px, calc(94vw - 252px)), (min-width: 1000px) calc(100vw - 288px), (min-width: 601px) calc(100vw - 48px), calc(100vw - 40px)' %}
<section class="hero-gallery" data-gallery aria-label="Display looks">
  <div class="gallery-slides">
    <figure data-gallery-slide data-gallery-title="Cyan">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/rendered/cyan-stars-4980.webp' | relative_url }}" aria-label="Expand cyan display" data-image-caption="Production-renderer sample. Cyan accents over a star field. Background and graph histories reconstructed.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/rendered/cyan-stars-830.webp' | relative_url }} 830w, {{ '/assets/img/showcase/gallery/rendered/cyan-stars-1660.webp' | relative_url }} 1660w, {{ '/assets/img/showcase/gallery/rendered/cyan-stars-2490.webp' | relative_url }} 2490w" sizes="{{ gallery_sizes }}"><img src="{{ '/assets/img/showcase/gallery/rendered/cyan-stars-830.webp' | relative_url }}" width="830" height="450" fetchpriority="high" alt="Production-renderer sample: thirty-six keys with cyan accents and six independent dials over a star field."></picture>
      </a>
      <figcaption>Cyan accents over a star field. Production-renderer sample. <a data-image-viewer href="{{ '/assets/img/showcase/gallery/cyan-stars.png' | relative_url }}" data-image-caption="Original live Stream Deck app capture. Cyan accents over a star field.">Original capture</a>.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Green · night">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/rendered/green-night-4980.webp' | relative_url }}" aria-label="Expand green night display" data-image-caption="Production-renderer sample. Green accents over a dark sky. Background and graph histories reconstructed.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/rendered/green-night-830.webp' | relative_url }} 830w, {{ '/assets/img/showcase/gallery/rendered/green-night-1660.webp' | relative_url }} 1660w, {{ '/assets/img/showcase/gallery/rendered/green-night-2490.webp' | relative_url }} 2490w" sizes="{{ gallery_sizes }}"><img src="{{ '/assets/img/showcase/gallery/rendered/green-night-830.webp' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Production-renderer sample: thirty-six keys with green accents and six independent dials over a dark sky."></picture>
      </a>
      <figcaption>Green accents over a dark sky. Production-renderer sample. <a data-image-viewer href="{{ '/assets/img/showcase/gallery/green-night.png' | relative_url }}" data-image-caption="Original live Stream Deck app capture. Green accents over a dark sky.">Original capture</a>.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Violet">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/rendered/violet-dusk-4980.webp' | relative_url }}" aria-label="Expand violet display" data-image-caption="Production-renderer sample. Violet accents over a dusk gradient. Background and graph histories reconstructed.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/rendered/violet-dusk-830.webp' | relative_url }} 830w, {{ '/assets/img/showcase/gallery/rendered/violet-dusk-1660.webp' | relative_url }} 1660w, {{ '/assets/img/showcase/gallery/rendered/violet-dusk-2490.webp' | relative_url }} 2490w" sizes="{{ gallery_sizes }}"><img src="{{ '/assets/img/showcase/gallery/rendered/violet-dusk-830.webp' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Production-renderer sample: thirty-six keys with violet accents and six independent dials over a purple-to-orange gradient."></picture>
      </a>
      <figcaption>Violet accents over a dusk gradient. Production-renderer sample. <a data-image-viewer href="{{ '/assets/img/showcase/gallery/violet-dusk.png' | relative_url }}" data-image-caption="Original live Stream Deck app capture. Violet accents over a dusk gradient.">Original capture</a>.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Amber">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/rendered/amber-dusk-4980.webp' | relative_url }}" aria-label="Expand amber display" data-image-caption="Production-renderer sample. Amber accents over a dusk gradient. Background and graph histories reconstructed.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/rendered/amber-dusk-830.webp' | relative_url }} 830w, {{ '/assets/img/showcase/gallery/rendered/amber-dusk-1660.webp' | relative_url }} 1660w, {{ '/assets/img/showcase/gallery/rendered/amber-dusk-2490.webp' | relative_url }} 2490w" sizes="{{ gallery_sizes }}"><img src="{{ '/assets/img/showcase/gallery/rendered/amber-dusk-830.webp' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Production-renderer sample: thirty-six keys with amber accents and six independent dials over a purple-to-orange gradient."></picture>
      </a>
      <figcaption>Amber accents over a dusk gradient. Production-renderer sample. <a data-image-viewer href="{{ '/assets/img/showcase/gallery/amber-dusk.png' | relative_url }}" data-image-caption="Original live Stream Deck app capture. Amber accents over a dusk gradient.">Original capture</a>.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Green · aurora">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/rendered/green-aurora-4980.webp' | relative_url }}" aria-label="Expand green aurora display" data-image-caption="Production-renderer sample. Green accents over an aurora. Background and graph histories reconstructed.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/rendered/green-aurora-830.webp' | relative_url }} 830w, {{ '/assets/img/showcase/gallery/rendered/green-aurora-1660.webp' | relative_url }} 1660w, {{ '/assets/img/showcase/gallery/rendered/green-aurora-2490.webp' | relative_url }} 2490w" sizes="{{ gallery_sizes }}"><img src="{{ '/assets/img/showcase/gallery/rendered/green-aurora-830.webp' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Production-renderer sample: thirty-six keys with green accents and six independent dials over a bright green aurora."></picture>
      </a>
      <figcaption>Green accents over an aurora. Production-renderer sample. <a data-image-viewer href="{{ '/assets/img/showcase/gallery/green-aurora.png' | relative_url }}" data-image-caption="Original live Stream Deck app capture. Green accents over an aurora.">Original capture</a>.</figcaption>
    </figure>
  </div>
  <div class="gallery-controls" hidden>
    <p class="gallery-position" data-gallery-position aria-live="polite" aria-atomic="true"></p>
    <div class="gallery-actions">
      <button type="button" data-gallery-previous aria-label="Previous look" title="Previous look"><span aria-hidden="true">‹</span></button>
      <button type="button" data-gallery-expand aria-label="Expand image" title="Expand image"><span aria-hidden="true">⤢</span></button>
      <button type="button" data-gallery-next aria-label="Next look" title="Next look"><span aria-hidden="true">›</span></button>
    </div>
  </div>
  <p class="capture-type">Backgrounds and graph histories are illustrative reconstructions. Original captures are linked for comparison.</p>
</section>

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
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/dial-backgrounds-strip.jpg' | relative_url }}" aria-label="Enlarge transparent background examples" data-image-credit="Cosmic Cliffs: NASA, ESA, CSA, and STScI. Cropped for the touch strip. Auroras: NASA." data-image-credit-url="https://esawebb.org/images/weic2205a/" data-image-license="CC BY 4.0 (Cosmic Cliffs)" data-image-license-url="https://creativecommons.org/licenses/by/4.0/"><picture><source type="image/webp" srcset="{{ '/assets/img/showcase/backgrounds-detail.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/backgrounds-detail.jpg' | relative_url }}" width="621" height="332" loading="lazy" decoding="async" alt="Separate dial slots over space, aurora and pale backgrounds in the Stream Deck app."></picture></a>
      <figcaption><h3><a href="{{ '/sensor-dial.html#transparent-background' | relative_url }}">Backgrounds <span aria-hidden="true">→</span></a></h3><p>Your touch strip picture, behind each dial.<br><span class="capture-type">App captures. Cosmic Cliffs: <a href="https://esawebb.org/images/weic2205a/">NASA, ESA, CSA, and STScI</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>; cropped. Auroras: NASA.</span></p></figcaption>
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
