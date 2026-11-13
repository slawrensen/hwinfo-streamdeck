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

<section class="hero-gallery" data-gallery aria-label="Display looks">
  <div class="gallery-slides">
    <figure data-gallery-slide data-gallery-title="Cyan">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/cyan-stars.png' | relative_url }}" aria-label="Expand cyan display" data-image-caption="Cyan accents over a star field. Live Stream Deck app capture.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/cyan-stars.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/gallery/cyan-stars.png' | relative_url }}" width="830" height="450" fetchpriority="high" alt="Thirty-six keys with cyan accents and six independent dials over a star field."></picture>
      </a>
      <figcaption>Cyan accents over a star field. Live Stream Deck app capture.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Green · night">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/green-night.png' | relative_url }}" aria-label="Expand green night display" data-image-caption="Green accents over a dark sky. Live Stream Deck app capture.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/green-night.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/gallery/green-night.png' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Thirty-six keys with green accents and six independent dials over a dark sky."></picture>
      </a>
      <figcaption>Green accents over a dark sky. Live Stream Deck app capture.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Violet">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/violet-dusk.png' | relative_url }}" aria-label="Expand violet display" data-image-caption="Violet accents over a dusk gradient. Live Stream Deck app capture.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/violet-dusk.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/gallery/violet-dusk.png' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Thirty-six keys with violet accents and six independent dials over a purple-to-orange gradient."></picture>
      </a>
      <figcaption>Violet accents over a dusk gradient. Live Stream Deck app capture.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Amber">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/amber-dusk.png' | relative_url }}" aria-label="Expand amber display" data-image-caption="Amber accents over a dusk gradient. Live Stream Deck app capture.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/amber-dusk.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/gallery/amber-dusk.png' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Thirty-six keys with amber accents and six independent dials over a purple-to-orange gradient."></picture>
      </a>
      <figcaption>Amber accents over a dusk gradient. Live Stream Deck app capture.</figcaption>
    </figure>
    <figure data-gallery-slide data-gallery-title="Green · aurora">
      <a class="image-link" data-image-viewer data-image-group="home-looks" href="{{ '/assets/img/showcase/gallery/green-aurora.png' | relative_url }}" aria-label="Expand green aurora display" data-image-caption="Green accents over an aurora. Live Stream Deck app capture.">
        <picture><source type="image/webp" srcset="{{ '/assets/img/showcase/gallery/green-aurora.webp' | relative_url }}"><img src="{{ '/assets/img/showcase/gallery/green-aurora.png' | relative_url }}" width="830" height="450" loading="lazy" decoding="async" alt="Thirty-six keys with green accents and six independent dials over a bright green aurora."></picture>
      </a>
      <figcaption>Green accents over an aurora. Live Stream Deck app capture.</figcaption>
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
    <figure>
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/strip-graphs-1.8.png' | relative_url }}" aria-label="Enlarge strip display examples"><img src="{{ '/assets/img/showcase/strip-detail.png' | relative_url }}" width="800" height="324" loading="lazy" decoding="async" alt="Three Stream Deck + touch strips, each one graph across all four dials: a Trend of two temperatures, a Heat graph and Meters with four large values."></a>
      <figcaption><h3><a href="{{ '/strip-display.html' | relative_url }}">Strip display <span aria-hidden="true">→</span></a></h3><p>One graph across the touch strip, or two side by side.<br><span class="capture-type">Sample rendering. Stream Deck + / + XL. New in 1.8.</span></p></figcaption>
    </figure>
    <figure>
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/deck-dusk-1.8.png' | relative_url }}" aria-label="Enlarge deck background example"><img src="{{ '/assets/img/showcase/deck-backgrounds-detail.png' | relative_url }}" width="640" height="400" loading="lazy" decoding="async" alt="A Stream Deck + XL page with Background Dusk: a blue-violet glow behind the lower key rows and a Trend graph across the strip."></a>
      <figcaption><h3><a href="{{ '/themes.html#deck-backgrounds-stars-dusk-and-nebula' | relative_url }}">Deck backgrounds <span aria-hidden="true">→</span></a></h3><p>Stars, Dusk or Nebula: one picture the plugin draws across the deck.<br><span class="capture-type">Sample rendering. New in 1.8.</span></p></figcaption>
    </figure>
    <figure>
      <a class="image-link showcase-image" data-image-viewer href="{{ '/assets/img/key-backgrounds-deck-1.8.png' | relative_url }}" aria-label="Enlarge key background example"><img src="{{ '/assets/img/showcase/key-backgrounds-detail.png' | relative_url }}" width="640" height="400" loading="lazy" decoding="async" alt="A Stream Deck + XL page with every key and dial on Tint over a blue to violet to orange gradient."></a>
      <figcaption><h3><a href="{{ '/sensor-reading.html#background' | relative_url }}">Key backgrounds <span aria-hidden="true">→</span></a></h3><p>Your page picture, behind each key.<br><span class="capture-type">Sample rendering over a gradient drawn for it. New in 1.8.</span></p></figcaption>
    </figure>
  </div>
</section>

<section class="home-paths" aria-labelledby="start-here">
  <h2 id="start-here">Find what you need</h2>
  <ul>
    <li><a href="{{ '/themes.html' | relative_url }}">Compare the seven themes <span aria-hidden="true">→</span></a><span>Pick a palette and set reading colors.</span></li>
    <li><a href="{{ '/strip-display.html' | relative_url }}">Join dials across the touch strip <span aria-hidden="true">→</span></a><span>One graph across the strip, or two side by side.</span></li>
    <li><a href="{{ '/data-sources.html' | relative_url }}">Understand your data source <span aria-hidden="true">→</span></a><span>Sharing, freshness, history, reading links and calculated readings.</span></li>
    <li><a href="{{ '/troubleshooting.html' | relative_url }}">Fix a status message <span aria-hidden="true">→</span></a><span>Find the exact message and the next step.</span></li>
  </ul>
  <p class="channel-note">1.8 joins Sensor Dials into one graph across the touch strip and adds time windows, limits for each reading, calculated readings and deck backgrounds. Some of it is not yet checked on real hardware; the strip page and the background sections say what was tested.</p>
  <p class="channel-note">GitHub: {{ site.plugin_release.package_version }}. Marketplace: {{ site.plugin_release.marketplace_version }} as checked {{ site.plugin_release.checked }}. <a href="{{ '/installation.html' | relative_url }}">Choose an install channel</a>.</p>
</section>
