/*********************************
 * Manga Translator - Core JS
 * Client-side PDF OCR + Translate (with client-side translation)
 *********************************/

// ====== Elements ======
const pdfInput = document.getElementById("pdfInput");
const startBtn = document.getElementById("startBtn");
const clearBtn = document.getElementById("clearBtn");
const statusText = document.getElementById("statusText");
const viewer = document.getElementById("viewer");

// ====== State ======
let pdfFile = null;

// ====== Telegram WebApp ======
let tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    try { tg.expand(); } catch(e){ /* ignore if not allowed */ }
}

// ====== Utility ======
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// ====== Events ======
pdfInput.addEventListener("change", (e) => {
    pdfFile = e.target.files[0];
    if (pdfFile) {
        statusText.innerText = `📄 فایل انتخاب شد: ${pdfFile.name}`;
    }
});

clearBtn.addEventListener("click", () => {
    viewer.innerHTML = "";
    pdfInput.value = "";
    pdfFile = null;
    statusText.innerText = "📌 منتظر انتخاب فایل...";
});

startBtn.addEventListener("click", async () => {
    if (!pdfFile) {
        alert("اول یه فایل PDF انتخاب کن");
        return;
    }

    statusText.innerText = "⏳ در حال پردازش PDF...";
    await processPDF(pdfFile);
});

// ====== PDF Processing ======
async function processPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        statusText.innerText = `📚 تعداد صفحات: ${pdf.numPages}`;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            statusText.innerText = `📄 پردازش صفحه ${pageNum}...`;
            const page = await pdf.getPage(pageNum);
            await renderPage(page, pageNum);
        }

        statusText.innerText = "✅ پردازش کامل شد";
    } catch (e) {
        console.error("processPDF error:", e);
        statusText.innerText = "❌ خطا در بارگذاری PDF";
        alert("خطا در پردازش PDF. کنسول را چک کن.");
    }
}

// ====== Render Page ======
async function renderPage(page, pageNumber) {
    const scale = 2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
        canvasContext: ctx,
        viewport: viewport
    }).promise;

    const imgData = canvas.toDataURL("image/png");

    const card = document.createElement("div");
    card.className = "page-card";

    const img = document.createElement("img");
    img.src = imgData;
    img.alt = `page-${pageNumber}`;

    const translationBox = document.createElement("div");
    translationBox.className = "translation-box";
    translationBox.innerText = "⏳ OCR در حال اجرا...";

    card.appendChild(img);
    card.appendChild(translationBox);
    viewer.appendChild(card);

    // OCR
    await runOCR(canvas, translationBox);
}

// ====== Translation functions ======
async function translateTextLibre(text, target = "fa") {
    // LibreTranslate public instance (may have rate limits). Uses user's network.
    const endpoint = "https://libretranslate.de/translate";
    const payload = { q: text, source: "auto", target: target, format: "text" };
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("LibreTranslate error " + res.status);
    const j = await res.json();
    return j.translatedText;
}

async function translateTextMyMemory(text, src = "en", dest = "fa") {
    // MyMemory fallback (GET, limited)
    const q = encodeURIComponent(text);
    const langpair = encodeURIComponent(`${src}|${dest}`);
    const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=${langpair}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("MyMemory error " + res.status);
    const j = await res.json();
    return (j.responseData && j.responseData.translatedText) ? j.responseData.translatedText : "";
}

async function translateText(text) {
    // Try LibreTranslate first, fallback to MyMemory
    try {
        return await translateTextLibre(text, "fa");
    } catch (e) {
        console.warn("LibreTranslate failed, trying MyMemory:", e);
        try {
            // MyMemory may detect source automatically but it's less reliable
            return await translateTextMyMemory(text, "auto", "fa");
        } catch (e2) {
            console.error("Translation fallback failed:", e2);
            throw e2;
        }
    }
}

// ====== OCR ======
async function runOCR(canvas, outputElement) {
    const worker = Tesseract.createWorker({
        logger: m => {
            // show progress only for recognizable statuses
            if (m.status && m.progress != null) {
                const pct = Math.round(m.progress * 100);
                outputElement.innerText = `🔍 OCR: ${m.status} ${pct}%`;
            } else if (m.status) {
                outputElement.innerText = `🔍 OCR: ${m.status}`;
            }
        }
    });

    try {
        await worker.load();
        // loadLanguage can accept combined langs like "jpn+eng"
        await worker.loadLanguage("jpn+eng");
        await worker.initialize("jpn+eng");

        const { data } = await worker.recognize(canvas);

        // ensure we have text
        const rawText = (data && data.text) ? data.text.trim() : "";
        if (!rawText) {
            outputElement.innerText = "❌ متنی شناسایی نشد";
            return;
        }

        // show original briefly then start translation
        outputElement.innerHTML = `<div style="color:#9aa0ff;margin-bottom:8px;white-space:pre-wrap;">${escapeHtml(rawText)}</div><div style="color:#aaa">🌐 در حال ترجمه...</div>`;

        // translate (uses user's network)
        let translated = "";
        try {
            translated = await translateText(rawText);
        } catch (e) {
            console.error("translateText error:", e);
            outputElement.innerHTML = `<div style="color:#9aa0ff;margin-bottom:8px;white-space:pre-wrap;">${escapeHtml(rawText)}</div><div style="color:#ff8a8a">❌ خطا در ترجمه</div>`;
            return;
        }

        // render final original + translated (translated on RTL)
        outputElement.innerHTML = `
            <div style="color:#9aa0ff;margin-bottom:10px;white-space:pre-wrap;font-size:0.95rem;">${escapeHtml(rawText)}</div>
            <div style="white-space:pre-wrap;direction:rtl;font-size:1rem;color:#eaeaff;">${escapeHtml(translated)}</div>
        `;
    } catch (err) {
        console.error("OCR error:", err);
        outputElement.innerText = "❌ خطا در OCR (کنسول را چک کنید)";
    } finally {
        try { await worker.terminate(); } catch (_) { /* ignore */ }
    }
}
