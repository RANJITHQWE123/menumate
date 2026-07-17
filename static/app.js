(() => {
  "use strict";

  const app = document.querySelector("#app");
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const PDFJS_VERSION = "4.10.38";
  const MAX_IMPORT_IMAGE_BYTES = 9 * 1024 * 1024;
  const MAX_PDF_PAGES = 20;
  let pdfjsPromise = null;
  const state = {
    restaurant: null,
    publicUrl: null,
    menu: [],
    questions: [],
    logs: [],
    importDrafts: [],
    importSource: null,
    questionIdeas: [],
    menuReview: "",
    voicePlan: null,
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
  const money = (cents) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
  const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers,
    });
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || "Something went wrong. Please try again.");
    return data;
  }

  function announce(message, type = "success") {
    const region = document.querySelector("#notice");
    if (!region) return;
    region.className = `notice ${type}`;
    region.textContent = message;
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => {
      region.className = "notice hidden";
      region.textContent = "";
    }, 4200);
  }

  function setTitle(title) {
    document.title = title ? `${title} · MenuMate` : "MenuMate";
  }

  function landing() {
    setTitle("");
    app.innerHTML = `
      <main class="landing-shell">
        <section class="landing-card">
          <a class="brand" href="/" aria-label="MenuMate home"><span class="brand-mark">M</span>MenuMate</a>
          <p class="eyebrow">QR menu + grounded AI waiter</p>
          <h1>Give every table a menu that can answer back.</h1>
          <p class="landing-copy">Owners control every item, note, special, and suggested question. Guests scan, browse, and ask with no login.</p>
          <a class="button primary large" href="/owner">Set up your restaurant</a>
          <p class="small-copy">Already set up? <a href="/owner">Log in to your dashboard</a>.</p>
        </section>
      </main>`;
  }

  function authView() {
    setTitle("Owner dashboard");
    app.innerHTML = `
      <main class="auth-shell">
        <a class="brand" href="/"><span class="brand-mark">M</span>MenuMate</a>
        <section class="auth-card">
          <div class="auth-heading"><p class="eyebrow">Restaurant owner</p><h1>Manage your menu</h1><p>One simple login for your restaurant.</p></div>
          <div id="notice" class="notice hidden" role="status"></div>
          <div class="tabs" role="tablist"><button class="tab active" data-auth-tab="signup" role="tab">Create account</button><button class="tab" data-auth-tab="login" role="tab">Log in</button></div>
          <form id="signup-form" class="auth-form">
            <label>Restaurant name<input name="restaurant_name" autocomplete="organization" required minlength="2" maxlength="100" placeholder="Juniper Kitchen" /></label>
            <label>Email<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@restaurant.com" /></label>
            <label>Password<span class="field-help">At least 10 characters</span><input name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="200" /></label>
            <button class="button primary" type="submit">Create dashboard</button>
          </form>
          <form id="login-form" class="auth-form hidden">
            <label>Email<input name="email" type="email" autocomplete="email" required maxlength="254" /></label>
            <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="200" /></label>
            <button class="button primary" type="submit">Log in</button>
          </form>
        </section>
      </main>`;
    document.querySelectorAll("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => {
      const isSignup = button.dataset.authTab === "signup";
      document.querySelectorAll("[data-auth-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      document.querySelector("#signup-form").classList.toggle("hidden", !isSignup);
      document.querySelector("#login-form").classList.toggle("hidden", isSignup);
    }));
    document.querySelector("#signup-form").addEventListener("submit", (event) => submitAuth(event, "/api/auth/signup"));
    document.querySelector("#login-form").addEventListener("submit", (event) => submitAuth(event, "/api/auth/login"));
  }

  async function submitAuth(event, endpoint) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = endpoint.endsWith("signup") ? "Creating…" : "Logging in…";
    try {
      const body = Object.fromEntries(new FormData(form));
      const result = await request(endpoint, { method: "POST", body: JSON.stringify(body) });
      state.restaurant = result.restaurant;
      state.publicUrl = result.public_url;
      await dashboard();
    } catch (error) {
      announce(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = endpoint.endsWith("signup") ? "Create dashboard" : "Log in";
    }
  }

  async function dashboard() {
    try {
      const [identity, menu, questions, logs] = await Promise.all([
        request("/api/owner/me"), request("/api/owner/menu"), request("/api/owner/questions"), request("/api/owner/chat-logs"),
      ]);
      state.restaurant = identity.restaurant;
      state.publicUrl = identity.public_url;
      state.menu = menu.items;
      state.questions = questions.questions;
      state.logs = logs.logs;
      dashboardView();
    } catch (error) {
      if (error.message === "Please log in to continue.") authView();
      else {
        authView();
        announce(error.message, "error");
      }
    }
  }

  function dashboardView() {
    setTitle(`${state.restaurant.name} dashboard`);
    app.innerHTML = `
      <header class="dashboard-topbar">
        <a class="brand" href="/"><span class="brand-mark">M</span>MenuMate</a>
        <div class="topbar-actions"><a class="text-link" href="/r/${encodeURIComponent(state.restaurant.slug)}" target="_blank" rel="noopener">View public menu</a><button id="logout" class="button quiet">Log out</button></div>
      </header>
      <main class="dashboard-shell">
        <div id="notice" class="notice hidden" role="status"></div>
        <section class="dashboard-intro"><div><p class="eyebrow">Owner dashboard</p><h1>${escapeHtml(state.restaurant.name)}</h1><p>Everything guests and the AI waiter see comes from the details you enter here.</p></div><a class="button secondary" href="/r/${encodeURIComponent(state.restaurant.slug)}" target="_blank" rel="noopener">Open menu ↗</a></section>
        <div class="dashboard-grid">
          <section class="panel menu-panel">
            <div class="panel-heading"><div><h2>Menu items</h2><p>Add prices, categories, and the free-text notes that guide your AI waiter.</p></div><button class="button primary" id="add-menu-item">Add item</button></div>
            <div id="menu-editor"></div>
            <div id="menu-list" class="menu-admin-list"></div>
          </section>
          <aside class="dashboard-side">
            <section class="panel import-panel"><div class="panel-heading compact"><div><h2>Import a menu</h2><p>Upload a PDF or clear menu photo. MenuMate reads each page, finds priced dishes, and gives you editable drafts. The original file is never published.</p></div></div>
              <form id="menu-import-form" class="import-form"><input name="menu" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" required /><button class="button primary" type="submit">Read menu with AI</button></form>
              <p class="field-help">PDF (up to 20 pages), JPG, PNG, or WebP · up to 10 MB · every extracted dish stays a draft until you approve it</p><div id="import-drafts"></div>
            </section>
            <section class="panel"><div class="panel-heading compact"><div><h2>Suggested questions</h2><p>Your own tappable prompts for guests.</p></div></div>
              <form id="question-form" class="inline-form"><input name="text" maxlength="240" required placeholder="e.g. What's available under $20?" aria-label="Suggested question" /><button class="button primary" type="submit">Add</button></form>
              <div id="question-list" class="question-admin-list"></div>
            </section>
            <section class="panel owner-tools-panel"><div class="panel-heading compact"><div><h2>Menu insights</h2><p>Useful guest questions and information gaps based only on the menu you have saved. These work even when AI is busy.</p></div></div>
              <div class="owner-tool-actions"><button class="button secondary" id="generate-question-ideas">Suggest guest questions</button><button class="button secondary" id="review-menu">Find missing details</button></div><div id="owner-tools-output"></div>
            </section>
            <section class="panel voice-panel"><div class="panel-heading compact"><div><h2>Menu assistant</h2><p>Tell it a change by voice or text: “make Lemon Pasta today’s special”, “delete Tomato Soup”, or “add a note to Curry: contains cashews.” You always review the plan before anything is changed.</p></div></div>
              <div class="voice-actions"><button class="button primary" id="start-voice" type="button">🎙 Talk to assistant</button><button class="button secondary" id="preview-voice" type="button">Create safe plan</button></div>
              <label class="voice-transcript-label">Tell the assistant what to change<textarea id="voice-transcript" maxlength="1000" rows="3" placeholder="Type an instruction here, or speak it with the microphone."></textarea></label><p class="field-help">Microphone input requires normal Chrome or Edge. Typing works in every browser.</p><div id="voice-preview"></div>
            </section>
            <section class="panel qr-panel"><div class="panel-heading compact"><div><h2>QR code</h2><p>Links directly to this restaurant's public menu.</p></div></div>
              <div class="qr-url"><code>${escapeHtml(state.publicUrl)}</code></div>
              <a class="button secondary full-width" href="/api/owner/qr" download>Download QR as PNG</a>
            </section>
            <section class="panel logs-panel"><div class="panel-heading compact"><div><h2>Recent guest questions</h2><p>Last 100 chat exchanges.</p></div></div><div id="chat-log-list"></div></section>
          </aside>
        </div>
      </main>`;
    renderMenuAdmin();
    renderQuestions();
    renderLogs();
    renderImportDrafts();
    renderOwnerTools();
    document.querySelector("#logout").addEventListener("click", logout);
    document.querySelector("#add-menu-item").addEventListener("click", () => openMenuEditor());
    document.querySelector("#question-form").addEventListener("submit", addQuestion);
    document.querySelector("#menu-import-form").addEventListener("submit", importMenuFile);
    document.querySelector("#generate-question-ideas").addEventListener("click", () => runOwnerTool("question_ideas"));
    document.querySelector("#review-menu").addEventListener("click", () => runOwnerTool("menu_review"));
    document.querySelector("#start-voice").addEventListener("click", startVoiceInput);
    document.querySelector("#preview-voice").addEventListener("click", previewVoiceCommand);
    renderVoicePlan();
    if (state.menu.length) { runOwnerTool("question_ideas"); runOwnerTool("menu_review"); }
  }

  function renderMenuAdmin() {
    const list = document.querySelector("#menu-list");
    if (!state.menu.length) {
      list.innerHTML = `<div class="empty-state"><strong>Your menu is empty.</strong><span>Add your first item to make it appear on the public menu.</span></div>`;
      return;
    }
    list.innerHTML = state.menu.map((item) => `
      <article class="admin-menu-row" data-menu-id="${item.id}">
        <div class="admin-menu-main"><div class="item-name-line"><h3>${escapeHtml(item.name)}</h3>${item.highlighted ? '<span class="special-badge">Highlighted</span>' : ""}</div><span class="category-label">${escapeHtml(item.category)}</span><p>${item.notes ? escapeHtml(item.notes) : '<em>No AI notes added.</em>'}</p></div>
        <div class="admin-menu-actions"><strong>${money(item.price_cents)}</strong><button class="button quiet edit-item" data-menu-id="${item.id}">Edit</button><button class="mini-button delete-item" data-menu-id="${item.id}">Delete</button></div>
      </article>`).join("");
    list.querySelectorAll(".edit-item").forEach((button) => button.addEventListener("click", () => {
      openMenuEditor(state.menu.find((item) => item.id === button.dataset.menuId));
    }));
    list.querySelectorAll(".delete-item").forEach((button) => button.addEventListener("click", () => deleteMenuItem(button.dataset.menuId)));
  }

  function openMenuEditor(item = null) {
    const editor = document.querySelector("#menu-editor");
    const isEditing = Boolean(item);
    editor.innerHTML = `
      <form id="menu-form" class="menu-form panel-inset">
        <div class="form-title"><h3>${isEditing ? "Edit item" : "Add menu item"}</h3><button type="button" class="icon-button" id="close-menu-editor" aria-label="Close">×</button></div>
        <div class="form-grid"><label>Name<input name="name" required maxlength="120" value="${escapeHtml(item?.name || "")}" placeholder="Miso glazed salmon" /></label><label>Price<input name="price" type="number" min="0" max="100000" step="0.01" required value="${item ? (item.price_cents / 100).toFixed(2) : ""}" placeholder="18.00" /></label><label>Category<input name="category" list="menu-categories" required maxlength="80" value="${escapeHtml(item?.category || "")}" placeholder="Main" /></label></div>
        <datalist id="menu-categories"><option>Starter</option><option>Main</option><option>Dessert</option><option>Drink</option><option>Side</option></datalist>
        <label class="notes-label">Notes for the AI waiter <span class="field-help">Free text: ingredients, allergens, heat, preparation, substitutions, nutrition—whatever you want it to know.</span><textarea name="notes" maxlength="4000" rows="4" placeholder="Contains toasted walnuts. Can be made mild on request. Gluten-free pasta available.">${escapeHtml(item?.notes || "")}</textarea></label>
        <label class="toggle"><input name="highlighted" type="checkbox" ${item?.highlighted ? "checked" : ""} /><span>Today’s special / highlight this item</span></label>
        <div class="form-actions">${isEditing ? `<button type="button" class="button danger" id="delete-menu-item">Delete</button>` : ""}<span class="form-actions-spacer"></span><button type="button" class="button quiet" id="cancel-menu-item">Cancel</button><button class="button primary" type="submit">${isEditing ? "Save changes" : "Add to menu"}</button></div>
      </form>`;
    editor.querySelector("#menu-form").addEventListener("submit", (event) => saveMenuItem(event, item?.id));
    editor.querySelector("#close-menu-editor").addEventListener("click", closeMenuEditor);
    editor.querySelector("#cancel-menu-item").addEventListener("click", closeMenuEditor);
    editor.querySelector("#delete-menu-item")?.addEventListener("click", () => deleteMenuItem(item.id));
    editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeMenuEditor() { document.querySelector("#menu-editor").innerHTML = ""; }

  async function saveMenuItem(event, itemId) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const data = Object.fromEntries(new FormData(form));
    data.highlighted = form.elements.highlighted.checked;
    button.disabled = true;
    try {
      const result = await request(itemId ? `/api/owner/menu/${itemId}` : "/api/owner/menu", { method: itemId ? "PATCH" : "POST", body: JSON.stringify(data) });
      state.menu = itemId ? state.menu.map((item) => item.id === itemId ? result.item : item) : [...state.menu, result.item];
      state.menu.sort((a, b) => Number(b.highlighted) - Number(a.highlighted) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      closeMenuEditor(); renderMenuAdmin(); announce(itemId ? "Menu item saved." : "Menu item added.");
    } catch (error) { announce(error.message, "error"); }
    finally { button.disabled = false; }
  }

  async function deleteMenuItem(itemId) {
    if (!window.confirm("Delete this menu item? This cannot be undone.")) return;
    try {
      await request(`/api/owner/menu/${itemId}`, { method: "DELETE" });
      state.menu = state.menu.filter((item) => item.id !== itemId);
      closeMenuEditor(); renderMenuAdmin(); announce("Menu item deleted.");
    } catch (error) { announce(error.message, "error"); }
  }

  async function loadPdfJs() {
    if (!pdfjsPromise) pdfjsPromise = import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
      return pdfjs;
    });
    return pdfjsPromise;
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }

  async function renderPdfPages(pdfDocument, file, longSide, quality) {
    const files = []; let totalBytes = 0;
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber); const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, longSide / Math.max(base.width, base.height)); const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false }); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
      const blob = await canvasToJpeg(canvas, quality); canvas.width = 1; canvas.height = 1; page.cleanup();
      if (!blob) throw new Error("This PDF page could not be prepared. Please try a clearer menu file.");
      totalBytes += blob.size;
      const baseName = file.name.replace(/\.[^.]+$/, "") || "menu";
      files.push(new File([blob], `${baseName}-page-${pageNumber}.jpg`, { type: "image/jpeg" }));
    }
    return { files, totalBytes };
  }

  async function pdfPagesForOcr(file) {
    let pdfjs;
    try { pdfjs = await loadPdfJs(); }
    catch { throw new Error("This browser could not prepare the PDF. Please open MenuMate in regular Chrome or Edge and try again."); }
    let pdfDocument;
    try { pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; }
    catch { throw new Error("That PDF could not be opened. Please use a standard PDF or a clear photo of the menu."); }
    if (!pdfDocument.numPages) throw new Error("That PDF has no pages to read.");
    if (pdfDocument.numPages > MAX_PDF_PAGES) throw new Error(`Please split this PDF into sections of ${MAX_PDF_PAGES} pages or fewer.`);
    let rendered = await renderPdfPages(pdfDocument, file, 1800, 0.84);
    if (rendered.totalBytes > MAX_IMPORT_IMAGE_BYTES) rendered = await renderPdfPages(pdfDocument, file, 1100, 0.68);
    if (rendered.totalBytes > MAX_IMPORT_IMAGE_BYTES) throw new Error("This PDF is too image-heavy to upload safely. Use a smaller PDF or upload its menu pages as clear photos.");
    return rendered.files;
  }

  async function importMenuFile(event) {
    event.preventDefault();
    const form = event.currentTarget; const file = form.elements.menu.files?.[0]; const button = form.querySelector("button");
    if (!file) return;
    button.disabled = true; button.textContent = "Preparing menu...";
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const files = isPdf ? await pdfPagesForOcr(file) : [file];
      button.textContent = isPdf ? "Reading PDF pages..." : "Reading menu...";
      const body = new FormData();
      for (const page of files) body.append("menu", page, page.name);
      body.set("ocr_pages", "true"); body.set("source_name", file.name);
      const result = await request("/api/owner/menu-import", { method: "POST", body });
      state.importDrafts = result.items.map((item) => ({ ...item, draftId: crypto.randomUUID() })); state.importSource = result.source || null;
      renderImportDrafts(); announce(result.message);
    } catch (error) { announce(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "Read menu with AI"; form.reset(); }
  }

  function renderImportDrafts() {
    const root = document.querySelector("#import-drafts"); if (!root) return;
    if (!state.importDrafts.length) { root.innerHTML = ""; return; }
    const readSummary = state.importSource?.characters_read ? `Read ${Number(state.importSource.characters_read).toLocaleString()} characters using ${escapeHtml(state.importSource.method || "menu reader")} from ${escapeHtml(state.importSource.name)}. ` : "";
    root.innerHTML = `<div class="import-drafts-heading"><strong>Review imported drafts</strong><span>${readSummary}Select the dishes you want to add. You can edit all details afterward.</span></div><div class="import-draft-list">${state.importDrafts.map((item) => `<label class="import-draft"><input type="checkbox" value="${escapeHtml(item.draftId)}" checked /><span class="import-draft-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)} · ${money(Math.round(item.price * 100))}</span>${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}${item.highlighted ? '<em>Marked as a highlight</em>' : ""}</span></label>`).join("")}</div><button class="button primary full-width" id="import-selected" type="button">Add selected items</button>`;
    root.querySelector("#import-selected").addEventListener("click", importSelectedDrafts);
  }

  async function importSelectedDrafts() {
    const root = document.querySelector("#import-drafts"); const selected = new Set([...root.querySelectorAll("input:checked")].map((input) => input.value));
    const drafts = state.importDrafts.filter((item) => selected.has(item.draftId));
    if (!drafts.length) { announce("Select at least one imported item.", "error"); return; }
    const button = root.querySelector("#import-selected"); button.disabled = true; button.textContent = "Adding itemsâ€¦";
    const added = []; let failure = null;
    for (const draft of drafts) {
      try {
        const result = await request("/api/owner/menu", { method: "POST", body: JSON.stringify(draft) });
        added.push({ draftId: draft.draftId, item: result.item });
      } catch (error) { failure = error; break; }
    }
    if (added.length) {
      state.menu.push(...added.map((entry) => entry.item));
      state.menu.sort((a, b) => Number(b.highlighted) - Number(a.highlighted) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      state.importDrafts = state.importDrafts.filter((draft) => !added.some((entry) => entry.draftId === draft.draftId));
      renderMenuAdmin(); renderImportDrafts();
    }
    if (failure) announce(`${added.length} item${added.length === 1 ? "" : "s"} added. The remaining items were not saved: ${failure.message}`, "error");
    else announce(`${added.length} menu item${added.length === 1 ? "" : "s"} added. Review the AI notes before sharing the menu.`);
  }

  function renderOwnerTools() {
    const root = document.querySelector("#owner-tools-output"); if (!root) return;
    const ideas = state.questionIdeas.length ? `<div class="owner-ideas"><strong>Question ideas</strong>${state.questionIdeas.map((idea, index) => `<div class="owner-idea"><span>${escapeHtml(idea)}</span><button class="mini-button add-idea" data-idea-index="${index}">Add</button></div>`).join("")}</div>` : "";
    const review = state.menuReview ? `<div class="owner-review"><strong>Menu check</strong><p>${escapeHtml(state.menuReview)}</p></div>` : "";
    root.innerHTML = ideas || review ? `${ideas}${review}` : "";
    root.querySelectorAll(".add-idea").forEach((button) => button.addEventListener("click", () => addQuestionIdea(Number(button.dataset.ideaIndex))));
  }

  async function runOwnerTool(action) {
    const button = document.querySelector(action === "question_ideas" ? "#generate-question-ideas" : "#review-menu"); const original = button.textContent;
    button.disabled = true; button.textContent = "Workingâ€¦";
    try {
      const result = await request("/api/owner/ai-tools", { method: "POST", body: JSON.stringify({ action }) });
      if (action === "question_ideas") { state.questionIdeas = result.questions; announce("Question ideas are ready. Add only the ones you want."); }
      else { state.menuReview = result.review; announce("Your private menu check is ready."); }
      renderOwnerTools();
    } catch (error) { announce(error.message, "error"); }
    finally { button.disabled = false; button.textContent = original; }
  }

  async function addQuestionIdea(index) {
    const text = state.questionIdeas[index]; if (!text) return;
    try {
      const result = await request("/api/owner/questions", { method: "POST", body: JSON.stringify({ text }) });
      state.questions.push(result.question); state.questionIdeas.splice(index, 1); renderQuestions(); renderOwnerTools(); announce("Suggested question added.");
    } catch (error) { announce(error.message, "error"); }
  }

  function voiceChangeDescription(change) {
    if (change.type === "add_item") return `Add <strong>${escapeHtml(change.item.name)}</strong> (${money(Math.round(change.item.price * 100))})`;
    if (change.type === "delete_item") return `Delete <strong>${escapeHtml(change.name)}</strong>`;
    if (change.type === "add_question") return `Add guest question: “${escapeHtml(change.text)}”`;
    const fields = [];
    if (Object.prototype.hasOwnProperty.call(change.fields, "name")) fields.push(`rename to ${escapeHtml(change.fields.name)}`);
    if (Object.prototype.hasOwnProperty.call(change.fields, "price")) fields.push(`price ${money(Math.round(change.fields.price * 100))}`);
    if (Object.prototype.hasOwnProperty.call(change.fields, "category")) fields.push(`category ${escapeHtml(change.fields.category)}`);
    if (Object.prototype.hasOwnProperty.call(change.fields, "notes")) fields.push(change.fields.notes ? "update AI notes" : "clear AI notes");
    if (Object.prototype.hasOwnProperty.call(change.fields, "highlighted")) fields.push(change.fields.highlighted ? "mark as today’s highlight" : "remove highlight");
    return `Change <strong>${escapeHtml(change.name)}</strong>: ${fields.join(", ")}`;
  }

  function renderVoicePlan() {
    const root = document.querySelector("#voice-preview"); if (!root) return;
    if (!state.voicePlan) { root.innerHTML = ""; return; }
    root.innerHTML = `<div class="voice-preview"><strong>Review before applying</strong><p>${escapeHtml(state.voicePlan.summary)}</p><div class="voice-change-list">${state.voicePlan.changes.map((change) => `<div class="voice-change ${change.type === "delete_item" ? "destructive" : ""}">${voiceChangeDescription(change)}</div>`).join("")}</div><button class="button primary full-width" id="apply-voice-plan" type="button">Apply these changes</button></div>`;
    root.querySelector("#apply-voice-plan").addEventListener("click", applyVoicePlan);
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { document.querySelector("#voice-transcript")?.focus(); announce("This browser cannot use the microphone. Type the instruction in the box, then tap Create safe plan."); return; }
    const button = document.querySelector("#start-voice"); const transcript = document.querySelector("#voice-transcript"); const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US"; recognition.interimResults = false; recognition.continuous = false; recognition.maxAlternatives = 1;
    button.disabled = true; button.textContent = "Listening…";
    recognition.onresult = async (event) => { transcript.value = [...event.results].map((result) => result[0].transcript).join(" ").trim(); button.disabled = false; button.textContent = "🎙 Talk to assistant"; await previewVoiceCommand(); };
    recognition.onerror = () => { button.disabled = false; button.textContent = "🎙 Talk to assistant"; document.querySelector("#voice-transcript")?.focus(); announce("This browser cannot use the microphone. Type the instruction in the box instead."); };
    recognition.onend = () => { button.disabled = false; button.textContent = "🎙 Talk to assistant"; };
    try { recognition.start(); } catch { button.disabled = false; button.textContent = "🎙 Talk to assistant"; announce("The microphone is already in use. Try again in a moment.", "error"); }
  }

  async function previewVoiceCommand() {
    const transcript = document.querySelector("#voice-transcript").value.trim(); if (transcript.length < 4) { announce("Speak or type a specific menu instruction first.", "error"); return; }
    const button = document.querySelector("#preview-voice"); const original = button.textContent; button.disabled = true; button.textContent = "Making plan…"; state.voicePlan = null; renderVoicePlan();
    try {
      state.voicePlan = await request("/api/owner/voice/plan", { method: "POST", body: JSON.stringify({ transcript }) });
      renderVoicePlan(); announce("Review the plan below. Nothing has changed yet.");
    } catch (error) { announce(error.message, "error"); }
    finally { button.disabled = false; button.textContent = original; }
  }

  async function applyVoicePlan() {
    const plan = state.voicePlan; if (!plan?.changes?.length) return;
    if (plan.changes.some((change) => change.type === "delete_item") && !window.confirm("This plan deletes a menu item. Apply it?")) return;
    const button = document.querySelector("#apply-voice-plan"); button.disabled = true; button.textContent = "Applying changes…";
    try {
      for (const change of plan.changes) {
        if (change.type === "add_item") await request("/api/owner/menu", { method: "POST", body: JSON.stringify(change.item) });
        else if (change.type === "update_item") await request(`/api/owner/menu/${encodeURIComponent(change.id)}`, { method: "PATCH", body: JSON.stringify(change.fields) });
        else if (change.type === "delete_item") await request(`/api/owner/menu/${encodeURIComponent(change.id)}`, { method: "DELETE", body: "{}" });
        else if (change.type === "add_question") await request("/api/owner/questions", { method: "POST", body: JSON.stringify({ text: change.text }) });
      }
      state.voicePlan = null; await dashboard(); announce("Voice changes applied. Your public menu is updated.");
    } catch (error) { announce(`Some changes may not have been applied: ${error.message}`, "error"); button.disabled = false; button.textContent = "Apply these changes"; }
  }

  function renderQuestions() {
    const list = document.querySelector("#question-list");
    if (!state.questions.length) {
      list.innerHTML = `<p class="empty-inline">No suggestions yet. Add only the questions you want guests to see.</p>`;
      return;
    }
    list.innerHTML = state.questions.map((question) => `<div class="question-admin-row"><span>${escapeHtml(question.text)}</span><div><button class="mini-button edit-question" data-question-id="${question.id}">Edit</button><button class="mini-button delete-question" data-question-id="${question.id}">Remove</button></div></div>`).join("");
    list.querySelectorAll(".edit-question").forEach((button) => button.addEventListener("click", () => editQuestion(button.dataset.questionId)));
    list.querySelectorAll(".delete-question").forEach((button) => button.addEventListener("click", () => deleteQuestion(button.dataset.questionId)));
  }

  async function addQuestion(event) {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector("button");
    const text = form.elements.text.value.trim(); if (!text) return;
    button.disabled = true;
    try {
      const result = await request("/api/owner/questions", { method: "POST", body: JSON.stringify({ text }) });
      state.questions.push(result.question); form.reset(); renderQuestions(); announce("Suggested question added.");
    } catch (error) { announce(error.message, "error"); } finally { button.disabled = false; }
  }

  async function editQuestion(questionId) {
    const question = state.questions.find((entry) => entry.id === questionId);
    const text = window.prompt("Edit suggested question", question?.text || "");
    if (text === null || !text.trim()) return;
    try {
      const result = await request(`/api/owner/questions/${questionId}`, { method: "PATCH", body: JSON.stringify({ text: text.trim() }) });
      state.questions = state.questions.map((entry) => entry.id === questionId ? result.question : entry); renderQuestions(); announce("Suggested question saved.");
    } catch (error) { announce(error.message, "error"); }
  }

  async function deleteQuestion(questionId) {
    if (!window.confirm("Remove this suggested question?")) return;
    try { await request(`/api/owner/questions/${questionId}`, { method: "DELETE" }); state.questions = state.questions.filter((entry) => entry.id !== questionId); renderQuestions(); announce("Suggested question removed."); }
    catch (error) { announce(error.message, "error"); }
  }

  function renderLogs() {
    const list = document.querySelector("#chat-log-list");
    if (!state.logs.length) { list.innerHTML = `<p class="empty-inline">Questions guests ask will appear here.</p>`; return; }
    list.innerHTML = state.logs.slice(0, 8).map((log) => `<article class="chat-log"><p class="chat-log-question">${escapeHtml(log.question)}</p><p>${escapeHtml(log.answer)}</p><time>${dateTime(log.created_at)}</time></article>`).join("");
  }

  async function logout() {
    try { await request("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) { /* Clear view even if the network drops. */ }
    state.restaurant = null; authView();
  }

  async function publicMenu(slug) {
    try {
      const data = await request(`/api/public/${encodeURIComponent(slug)}`);
      setTitle(data.restaurant.name);
      renderPublicMenu(data);
    } catch (error) { publicError(error.message); }
  }

  function publicError(message) {
    app.innerHTML = `<main class="public-shell"><section class="public-error"><a class="brand" href="/"><span class="brand-mark">M</span>MenuMate</a><h1>Menu unavailable</h1><p>${escapeHtml(message)}</p></section></main>`;
  }

  function renderPublicMenu(data) {
    const highlighted = data.items.filter((item) => item.highlighted);
    const groups = new Map();
    data.items.forEach((item) => { const key = item.category || "Menu"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    app.innerHTML = `
      <main class="public-shell">
        <header class="public-header"><a class="brand light" href="/"><span class="brand-mark">M</span>MenuMate</a><p class="eyebrow">Digital menu</p><h1>${escapeHtml(data.restaurant.name)}</h1><p>Browse the menu, then ask the AI waiter about what’s listed.</p></header>
        <section class="public-menu">
          ${highlighted.length ? `<section class="highlights"><div class="section-kicker">Today’s highlights</div><div class="highlight-grid">${highlighted.map(publicItem).join("")}</div></section>` : ""}
          ${groups.size ? [...groups.entries()].map(([category, items]) => `<section class="category-section"><h2>${escapeHtml(category)}</h2><div class="menu-cards">${items.map(publicItem).join("")}</div></section>`).join("") : `<section class="empty-public"><h2>The menu is being prepared</h2><p>Please check with the team for today’s offerings.</p></section>`}
        </section>
      </main>
      <section class="waiter" aria-label="Ask our AI waiter"><div class="waiter-inner"><div class="waiter-head"><div><p class="eyebrow">Need a hand?</p><h2>Ask our AI waiter</h2></div><span class="waiter-status">Menu-aware</span></div><div id="chat-messages" class="chat-messages" aria-live="polite"><div class="chat-message assistant">I can help with what’s listed on this menu. For details that aren’t in the notes, I’ll check with staff.</div></div>${data.suggested_questions.length ? `<div class="chips" aria-label="Suggested questions">${data.suggested_questions.map((question) => `<button class="chip" data-question="${escapeHtml(question.text)}">${escapeHtml(question.text)}</button>`).join("")}</div>` : ""}<form id="chat-form" class="chat-form"><label class="sr-only" for="chat-input">Ask a question about this menu</label><input id="chat-input" name="question" maxlength="1000" placeholder="Ask about dishes, prices, or notes…" autocomplete="off" required /><button class="button secondary mic-button" id="public-mic" type="button" aria-label="Speak your question">🎙</button><button class="button primary" type="submit">Ask</button></form><p class="voice-help">Tap the microphone to speak in Chrome or Edge, or type your question.</p></div></section>`;
    document.querySelector("#chat-form").addEventListener("submit", (event) => sendChat(event, data.restaurant.slug));
    document.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
      document.querySelector("#chat-input").value = chip.dataset.question; document.querySelector("#chat-form").requestSubmit();
    }));
    document.querySelector("#public-mic").addEventListener("click", () => startPublicVoice(data.restaurant.slug));
  }

  function publicItem(item) {
    return `<article class="public-item ${item.highlighted ? "featured" : ""}"><div class="public-item-title"><h3>${escapeHtml(item.name)}</h3><strong>${money(item.price_cents)}</strong></div>${item.highlighted ? '<span class="special-badge">Today’s highlight</span>' : ""}</article>`;
  }

  async function sendChat(event, slug) {
    event.preventDefault();
    const form = event.currentTarget; const input = form.elements.question; const question = input.value.trim(); if (!question) return;
    const button = form.querySelector('button[type="submit"]'); const messages = document.querySelector("#chat-messages");
    messages.insertAdjacentHTML("beforeend", `<div class="chat-message user">${escapeHtml(question)}</div><div class="chat-message assistant pending">Looking at the menu…</div>`);
    input.value = ""; input.disabled = true; button.disabled = true; messages.scrollTop = messages.scrollHeight;
    try {
      const result = await request(`/api/public/${encodeURIComponent(slug)}/chat`, { method: "POST", body: JSON.stringify({ question }) });
      messages.querySelector(".pending")?.remove(); messages.insertAdjacentHTML("beforeend", `<div class="chat-message assistant">${escapeHtml(result.answer)}</div>`);
    } catch (error) {
      messages.querySelector(".pending")?.remove(); messages.insertAdjacentHTML("beforeend", `<div class="chat-message assistant error-message">${escapeHtml(error.message)}</div>`);
    } finally { input.disabled = false; button.disabled = false; input.focus(); messages.scrollTop = messages.scrollHeight; }
  }

  function startPublicVoice(slug) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const input = document.querySelector("#chat-input"); const button = document.querySelector("#public-mic"); const messages = document.querySelector("#chat-messages");
    if (!Recognition) { input.focus(); messages.insertAdjacentHTML("beforeend", `<div class="chat-message assistant">Voice input needs Chrome or Edge. You can type your question here.</div>`); messages.scrollTop = messages.scrollHeight; return; }
    const recognition = new Recognition(); recognition.lang = navigator.language || "en-US"; recognition.interimResults = false; recognition.continuous = false; recognition.maxAlternatives = 1;
    button.disabled = true; button.textContent = "…";
    recognition.onresult = (event) => { input.value = [...event.results].map((result) => result[0].transcript).join(" ").trim(); document.querySelector("#chat-form").requestSubmit(); };
    recognition.onerror = () => { messages.insertAdjacentHTML("beforeend", `<div class="chat-message assistant">I could not access the microphone. Please type your question.</div>`); messages.scrollTop = messages.scrollHeight; input.focus(); };
    recognition.onend = () => { button.disabled = false; button.textContent = "🎙"; };
    try { recognition.start(); } catch { button.disabled = false; button.textContent = "🎙"; input.focus(); }
  }

  if (path === "/owner") dashboard();
  else if (path.startsWith("/r/")) publicMenu(decodeURIComponent(path.slice(3)));
  else landing();
})();
