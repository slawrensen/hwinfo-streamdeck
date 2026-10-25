/* Progressive enhancements for the documentation, independent of plugin code. */
(() => {
	"use strict";
	document.documentElement.classList.add("docs-js");

	function init() {
		const content = document.getElementById("main-content");
		if (!content) return;
		const menu = document.getElementById("menu-button");
		const nav = document.getElementById("site-nav");
		const header = document.getElementById("main-header");
		const updateMenu = () => {
			const open = nav.classList.contains("nav-open");
			menu.setAttribute("aria-expanded", String(open));
			menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
		};
		new MutationObserver(updateMenu).observe(nav, { attributes: true, attributeFilter: ["class"] });
		document.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			// The native dialog owns Escape while open. Do not change the
			// navigation or search state in the inert page behind it.
			if (document.querySelector("dialog.image-viewer[open]")) return;
			const searchInput = document.getElementById("search-input");
			if (searchInput && document.documentElement.classList.contains("search-active")) {
				// Clear through the search input handler before moving focus.
				// JTD's Escape keyup cannot run if navigation takes focus first.
				searchInput.value = "";
				searchInput.dispatchEvent(new Event("input", { bubbles: true }));
				searchInput.focus({ preventScroll: true });
				event.preventDefault();
				return;
			}
			if (!nav.classList.contains("nav-open")) return;
			nav.classList.remove("nav-open");
			header.classList.remove("nav-open");
			menu.classList.remove("nav-open");
			menu.setAttribute("aria-pressed", "false");
			menu.focus();
		});

		// Jekyll's table wrapper remains usable without JavaScript. Add a named
		// keyboard scroll region only when a table exceeds its available width.
		const tables = [...content.querySelectorAll(".table-wrapper, pre")];
		function labelTables() {
			tables.forEach((table, index) => {
				if (table.scrollWidth > table.clientWidth + 1) {
					table.tabIndex = 0;
					table.setAttribute("role", "region");
					const heading = [...content.querySelectorAll("h2, h3")].filter((h) => h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
					table.setAttribute("aria-label", `${heading ? heading.textContent.trim() : `Reference ${index + 1}`} ${table.tagName === "PRE" ? "code example" : "table"} ${index + 1}, scroll horizontally`);
				} else {
					table.removeAttribute("tabindex");
					table.removeAttribute("role");
					table.removeAttribute("aria-label");
				}
			});
		}
		labelTables();
		if (typeof ResizeObserver === "function") new ResizeObserver(labelTables).observe(content);

		const toc = document.querySelector(".page-toc");
		const headings = [...content.querySelectorAll("h2[id]")];
		if (toc && headings.length >= 4) {
			const details = document.createElement("details");
			const summary = document.createElement("summary");
			summary.textContent = "On this page";
			details.append(summary);
			const links = document.createElement("ul");
			headings.forEach((heading) => {
				const item = document.createElement("li");
				const link = document.createElement("a");
				link.href = `#${heading.id}`;
				link.textContent = heading.textContent.trim();
				item.append(link);
				links.append(item);
			});
			details.append(links);
			toc.append(details);
			toc.hidden = false;
			// CSS owns the rail breakpoint. Preserve a manual disclosure choice
			// until the layout changes between the inline and side positions.
			let previousSideLayout;
			const syncContentsLayout = () => {
				const sideLayout = window.getComputedStyle(toc).position === "sticky";
				if (sideLayout === previousSideLayout) return;
				if (!sideLayout && details.contains(document.activeElement)) summary.focus({ preventScroll: true });
				details.open = sideLayout;
				previousSideLayout = sideLayout;
			};
			syncContentsLayout();
			window.addEventListener("resize", syncContentsLayout);
		}

		function revealHash() {
			let id;
			try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
			const target = id && document.getElementById(id);
			if (!target) return;
			let parent = target;
			let opened = false;
			while (parent) {
				if (parent.tagName === "DETAILS" && !parent.open) { parent.open = true; opened = true; }
				parent = parent.parentElement;
			}
			if (opened) requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
		}
		window.addEventListener("hashchange", revealHash);
		window.addEventListener("pageshow", revealHash);
		content.addEventListener("beforematch", (event) => {
			let parent = event.target.closest("details");
			while (parent) { parent.open = true; parent = parent.parentElement.closest("details"); }
		});
		document.addEventListener("click", (event) => {
			const link = event.target.closest("a[href]");
			if (link && link.hash && link.origin === location.origin && link.pathname === location.pathname) setTimeout(revealHash, 0);
		});
		revealHash();

		const results = document.getElementById("search-results");
		const status = document.getElementById("search-status");
		if (results && status) {
			let announce;
			new MutationObserver(() => {
				clearTimeout(announce);
				announce = setTimeout(() => {
					const count = results.querySelectorAll(".search-result").length;
					status.textContent = document.getElementById("search-input").value ? `${count} search result${count === 1 ? "" : "s"}` : "";
				}, 200);
			}).observe(results, { childList: true, subtree: true });
		}

		// Links retain a useful full-image destination without script or dialog
		// support. Native showModal makes the background inert; the explicit
		// tab loop prevents focus leaving the viewer for browser chrome, too.
		let viewer, stage, fullImage, caption, toggle, closeButton, opener, previousOverflow;
		let viewerNavigation, viewerPosition, viewerStatus, originalLink, viewerHelp, viewerCredit;
		let group = [], currentImage = 0, imageRequest = 0;
		const galleries = new WeakMap();
		function updateViewerHelp() {
			viewerHelp.textContent = stage.classList.contains("is-full")
				? "Scroll or use arrow keys in the image to pan. Escape closes."
				: `${group.length > 1 ? "Use Left and Right to browse. " : ""}Actual size shows the original pixels. Escape closes.`;
		}
		function setFull(full) {
			stage.classList.toggle("is-full", full);
			stage.classList.toggle("is-fit", !full);
			toggle.textContent = full ? "Fit to screen" : "Actual size";
			updateViewerHelp();
			requestAnimationFrame(() => {
				stage.scrollTop = full ? Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2) : 0;
				stage.scrollLeft = full ? Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2) : 0;
			});
		}
		function showImage(index) {
			// Error and credit links can disappear as a new image is selected.
			// Move their focus before hiding/removing them so it stays in the modal.
			if (document.activeElement === originalLink || viewerCredit.contains(document.activeElement)) closeButton.focus();
			currentImage = (index + group.length) % group.length;
			const link = group[currentImage];
			const image = document.createElement("img");
			const request = ++imageRequest;
			image.alt = link.querySelector("img")?.alt || link.dataset.imageCaption || "Enlarged documentation image";
			image.hidden = true;
			fullImage.replaceWith(image);
			fullImage = image;
			caption.textContent = link.dataset.imageCaption || image.alt;
			viewerPosition.textContent = `${currentImage + 1} / ${group.length}`;
			viewerNavigation.hidden = group.length < 2;
			viewerStatus.textContent = "Loading image…";
			originalLink.href = link.href;
			originalLink.hidden = true;
			viewerCredit.replaceChildren();
			viewerCredit.hidden = !link.dataset.imageCredit && !link.dataset.imageLicense;
			function appendCredit(text, url) {
				if (!text) return;
				let source;
				try { source = new URL(url); } catch { /* An optional source URL must be absolute. */ }
				if (source && ["https:", "http:"].includes(source.protocol)) {
					const credit = document.createElement("a");
					credit.href = source.href;
					credit.textContent = text;
					viewerCredit.append(credit);
				} else viewerCredit.append(document.createTextNode(text));
			}
			appendCredit(link.dataset.imageCredit, link.dataset.imageCreditUrl);
			if (link.dataset.imageCredit && link.dataset.imageLicense) viewerCredit.append(document.createTextNode(" · "));
			appendCredit(link.dataset.imageLicense, link.dataset.imageLicenseUrl);
			toggle.disabled = false;
			stage.setAttribute("aria-busy", "true");
			setFull(false);
			const gallery = link.closest("[data-gallery]");
			galleries.get(gallery)?.showLink(link);
			const isCurrent = () => request === imageRequest && fullImage === image && viewer.open;
			const loaded = () => {
				if (!isCurrent()) return;
				image.hidden = false;
				viewerStatus.textContent = "";
				stage.removeAttribute("aria-busy");
				setFull(stage.classList.contains("is-full"));
			};
			const failed = () => {
				if (!isCurrent()) return;
				viewerStatus.textContent = group.length > 1
					? "This image could not be loaded. Try another image or open the original."
					: "This image could not be loaded. Open the original or close the viewer and try again.";
				originalLink.hidden = false;
				stage.removeAttribute("aria-busy");
				setFull(false);
				if (document.activeElement === toggle) closeButton.focus();
				toggle.disabled = true;
			};
			image.src = link.href;
			// Cached images can decode before their queued load event fires. Reveal
			// the decoded pixels directly so revisiting a look never adds a blank frame.
			image.decode().then(loaded, failed);
		}
		function finishClosingViewer() {
			if (viewer.open || previousOverflow === null) return;
			document.body.style.overflow = previousOverflow;
			previousOverflow = null;
			imageRequest++;
			fullImage.removeAttribute("src");
			fullImage.hidden = true;
			// Browsing can hide the original slide. In that case, restore focus
			// to the currently displayed image; an external Expand button stays put.
			const selected = group[currentImage];
			const activeLink = galleries.get(selected?.closest("[data-gallery]"))?.currentLink();
			const focusTarget = opener?.getClientRects().length ? opener : selected?.getClientRects().length ? selected : activeLink;
			if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
		}
		function closeViewer() {
			viewer.close();
			// The native close event is queued. Restore focus immediately so the
			// next key cannot land in the document after its original slide hid.
			finishClosingViewer();
		}
		function buildViewer() {
			viewer = document.createElement("dialog");
			viewer.className = "image-viewer";
			viewer.setAttribute("aria-labelledby", "image-viewer-title");
			viewer.setAttribute("aria-describedby", "image-viewer-caption image-viewer-credit");
			viewer.innerHTML = '<h2 id="image-viewer-title" class="sr-only">Image viewer</h2><div class="viewer-toolbar"><p class="viewer-caption" id="image-viewer-caption"></p><button type="button" data-viewer-toggle>Actual size</button><button type="button" data-viewer-close>Close</button></div><div class="viewer-stage is-fit" tabindex="0" role="region" aria-label="Image, scroll to pan at actual size"><img alt=""></div><div class="viewer-notice"><p class="viewer-status" role="status"></p><a class="viewer-original" hidden>Open original image</a></div><p class="viewer-credit" id="image-viewer-credit" hidden></p><div class="viewer-navigation" role="group" aria-label="Image navigation" hidden><button type="button" data-viewer-previous aria-label="Previous image" title="Previous image">‹</button><span class="viewer-position" aria-live="polite" aria-atomic="true"></span><button type="button" data-viewer-next aria-label="Next image" title="Next image">›</button></div><p class="viewer-help"></p>';
			document.body.append(viewer);
			stage = viewer.querySelector(".viewer-stage");
			fullImage = stage.querySelector("img");
			caption = viewer.querySelector(".viewer-caption");
			toggle = viewer.querySelector("[data-viewer-toggle]");
			closeButton = viewer.querySelector("[data-viewer-close]");
			viewerNavigation = viewer.querySelector(".viewer-navigation");
			viewerPosition = viewer.querySelector(".viewer-position");
			viewerStatus = viewer.querySelector(".viewer-status");
			originalLink = viewer.querySelector(".viewer-original");
			viewerCredit = viewer.querySelector(".viewer-credit");
			viewerHelp = viewer.querySelector(".viewer-help");
			toggle.addEventListener("click", () => setFull(!stage.classList.contains("is-full")));
			closeButton.addEventListener("click", closeViewer);
			viewer.querySelector("[data-viewer-previous]").addEventListener("click", () => showImage(currentImage - 1));
			viewer.querySelector("[data-viewer-next]").addEventListener("click", () => showImage(currentImage + 1));
			viewer.addEventListener("keydown", (event) => {
				if (group.length > 1 && stage.classList.contains("is-fit") && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
					&& (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
					event.preventDefault();
					showImage(currentImage + (event.key === "ArrowLeft" ? -1 : 1));
					return;
				}
				if (event.key !== "Tab") return;
				const stops = [...viewer.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
					.filter(element => element.getClientRects().length > 0);
				const current = stops.indexOf(document.activeElement);
				if (event.shiftKey && current <= 0) { event.preventDefault(); stops.at(-1).focus(); }
				else if (!event.shiftKey && (current === stops.length - 1 || current === -1)) { event.preventDefault(); stops[0].focus(); }
			});
			viewer.addEventListener("close", finishClosingViewer);
			viewer.addEventListener("cancel", event => {
				event.preventDefault();
				closeViewer();
			});
			viewer.addEventListener("click", (event) => {
				if (event.target !== viewer) return;
				const rect = viewer.getBoundingClientRect();
				if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeViewer();
			});
		}
		function openViewer(link, trigger = link) {
			if (typeof HTMLDialogElement !== "function" || typeof HTMLDialogElement.prototype.showModal !== "function") return false;
			if (!viewer) buildViewer();
			opener = trigger;
			const groupName = link.dataset.imageGroup;
			const candidates = groupName ? [...content.querySelectorAll("a[data-image-viewer][data-image-group]")].filter(candidate => {
				if (candidate.dataset.imageGroup !== groupName) return false;
				// Inactive carousel slides are intentional group members. Images in
				// unrelated closed disclosures are not silently added to the viewer.
				const gallery = candidate.closest("[data-gallery]");
				return candidate.getClientRects().length > 0 || (galleries.has(gallery) && gallery.getClientRects().length > 0);
			}) : [link];
			group = [...new Map(candidates.map(candidate => [candidate.href, candidate])).values()];
			if (!group.some(candidate => candidate.href === link.href)) group = [link];
			previousOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			viewer.showModal();
			showImage(group.findIndex(candidate => candidate.href === link.href));
			toggle.focus();
			return true;
		}
		content.querySelectorAll("[data-gallery]").forEach(gallery => {
			const slides = [...gallery.querySelectorAll("[data-gallery-slide]")];
			const controls = gallery.querySelector(".gallery-controls");
			const position = gallery.querySelector("[data-gallery-position]");
			const previous = gallery.querySelector("[data-gallery-previous]");
			const next = gallery.querySelector("[data-gallery-next]");
			const expand = gallery.querySelector("[data-gallery-expand]");
			if (!slides.length || !controls || !position || !previous || !next || !expand) return;
			let active = 0, requestedSlide = 0, slideRequest = 0;
			const linkAt = index => slides[index].querySelector("a[data-image-viewer]");
			if (slides.some((_, index) => !linkAt(index))) return;
			const showPosition = () => {
				position.textContent = `${slides[active].dataset.galleryTitle ? `${slides[active].dataset.galleryTitle} · ` : ""}${active + 1} / ${slides.length}`;
			};
			async function showSlide(index) {
				const target = (index + slides.length) % slides.length;
				requestedSlide = target;
				const request = ++slideRequest;
				const image = linkAt(target).querySelector("img");
				image.loading = "eager";
				if (!image.complete || !image.naturalWidth) {
					position.textContent = `Loading look ${target + 1} of ${slides.length}…`;
					try { await image.decode(); }
					catch {
						if (request !== slideRequest) return;
						requestedSlide = active;
						position.textContent = "That look could not be loaded. Try another.";
						return;
					}
				}
				if (request !== slideRequest) return;
				// Keep the existing frame and caption together until the replacement
				// is ready. Restore a focused image link only if it will be hidden.
				const restoreFocus = active !== target && slides[active].contains(document.activeElement);
				active = target;
				slides.forEach((slide, i) => { slide.hidden = i !== active; });
				showPosition();
				if (restoreFocus) linkAt(active).focus({ preventScroll: true });
			}
			galleries.set(gallery, {
				showLink: link => showSlide(slides.findIndex(slide => slide.contains(link))),
				currentLink: () => linkAt(active)
			});
			previous.addEventListener("click", () => showSlide(requestedSlide - 1));
			next.addEventListener("click", () => showSlide(requestedSlide + 1));
			expand.addEventListener("click", () => {
				if (!openViewer(linkAt(active), expand)) window.location.href = linkAt(active).href;
			});
			gallery.addEventListener("keydown", event => {
				if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
				event.preventDefault();
				showSlide(requestedSlide + (event.key === "ArrowLeft" ? -1 : 1));
			});
			previous.hidden = next.hidden = slides.length < 2;
			slides.forEach((slide, index) => { slide.hidden = index !== active; });
			showPosition();
			controls.hidden = false;
		});
		content.addEventListener("click", (event) => {
			const link = event.target.closest("a[data-image-viewer]");
			if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
			if (openViewer(link)) event.preventDefault();
		});
		content.querySelectorAll("img").forEach((image) => {
			if (image.closest("a")) return;
			const wrap = image.closest("picture") || image;
			const link = document.createElement("a");
			link.href = image.dataset.fullSrc || image.src;
			link.className = "image-link";
			link.dataset.imageViewer = "";
			link.setAttribute("aria-label", `Enlarge image: ${image.alt || "documentation example"}`);
			wrap.before(link);
			link.append(wrap);
		});
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
	else init();
})();
