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
		function setFull(full) {
			stage.classList.toggle("is-full", full);
			stage.classList.toggle("is-fit", !full);
			toggle.textContent = full ? "Fit to screen" : "Actual size";
			requestAnimationFrame(() => {
				stage.scrollTop = full ? Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2) : 0;
				stage.scrollLeft = full ? Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2) : 0;
			});
		}
		function buildViewer() {
			viewer = document.createElement("dialog");
			viewer.className = "image-viewer";
			viewer.setAttribute("aria-labelledby", "image-viewer-title");
			viewer.setAttribute("aria-describedby", "image-viewer-caption");
			viewer.innerHTML = '<h2 id="image-viewer-title" class="sr-only">Image viewer</h2><div class="viewer-toolbar"><p class="viewer-caption" id="image-viewer-caption"></p><button type="button" data-viewer-toggle>Actual size</button><button type="button" data-viewer-close>Close</button></div><div class="viewer-stage is-fit" tabindex="0" role="region" aria-label="Image, scroll to pan at actual size"><img alt=""></div><p class="viewer-help">Actual size shows the original pixels. Scroll to pan. Escape closes.</p>';
			document.body.append(viewer);
			stage = viewer.querySelector(".viewer-stage");
			fullImage = stage.querySelector("img");
			caption = viewer.querySelector(".viewer-caption");
			toggle = viewer.querySelector("[data-viewer-toggle]");
			closeButton = viewer.querySelector("[data-viewer-close]");
			toggle.addEventListener("click", () => setFull(!stage.classList.contains("is-full")));
			closeButton.addEventListener("click", () => viewer.close());
			viewer.addEventListener("keydown", (event) => {
				if (event.key !== "Tab") return;
				const stops = [toggle, closeButton, stage];
				const current = stops.indexOf(document.activeElement);
				if (event.shiftKey && current <= 0) { event.preventDefault(); stops.at(-1).focus(); }
				else if (!event.shiftKey && (current === stops.length - 1 || current === -1)) { event.preventDefault(); stops[0].focus(); }
			});
			viewer.addEventListener("close", () => {
				document.body.style.overflow = previousOverflow;
				fullImage.removeAttribute("src");
				if (opener?.isConnected) opener.focus({ preventScroll: true });
			});
			viewer.addEventListener("click", (event) => {
				if (event.target !== viewer) return;
				const rect = viewer.getBoundingClientRect();
				if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
			});
		}
		content.addEventListener("click", (event) => {
			const link = event.target.closest("a[data-image-viewer]");
			if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
			if (typeof HTMLDialogElement !== "function" || typeof HTMLDialogElement.prototype.showModal !== "function") return;
			event.preventDefault();
			if (!viewer) buildViewer();
			opener = link;
			const image = link.querySelector("img");
			fullImage.src = link.href;
			fullImage.alt = image?.alt || "Enlarged documentation image";
			caption.textContent = link.dataset.imageCaption || fullImage.alt;
			setFull(false);
			previousOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			viewer.showModal();
			toggle.focus();
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
