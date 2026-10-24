// Import modules
import "./style.css";
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import worker_js from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import selectAllQuery from "./sql/select_all.sql?raw";
import selectAllLimit100Query from "./sql/select_all_limit_100.sql?raw";
// import countAllQuery from "./sql/count_all.sql?raw";

// Set parameters for the application
async function startApp() {
  const MAX_UPLOAD_ROWS = 100_000;
  const PAGE_SIZE = 100;
  const PAGE_SIZES = [25, 50, 100, 250];
  const SEARCH_DEBOUNCE_MS = 1_000;
  let allDataPageSize = PAGE_SIZE;

  // Define the available query configurations; buttons will be created for each query
  const queryConfigs = [
    { label: "View all data", sql: selectAllQuery },
    { label: "View top 100 rows", sql: selectAllLimit100Query },
    // { label: "Count rows", sql: countAllQuery },
  ];

  // Setup DuckDB in the browser worker
  const PERSISTENT_STORAGE = true;
  const worker = new Worker(worker_js);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(duckdb_wasm);

  // Configure persistent storage using OPFS or fallback to memory
  if (PERSISTENT_STORAGE) {
    await db.open({
      path: "opfs://yoshimitsu_data.duckdb",
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      opfs: { fileHandling: "auto" },
    });
  } else {
    await db.open({ path: ":memory:" });
  }

  const connection = await db.connect();

  // Get the HTML elements from index.html
  const fileInput = document.getElementById("csvInput");
  const searchInput = document.getElementById("searchInput");
  const queryButtonsDiv = document.getElementById("queryButtons");
  const outputDiv = document.getElementById("output");
  const themeToggle = document.getElementById("themeToggle");
  const themeToggleIcon = document.querySelector(".theme-toggle-icon");
  const themeToggleLabel = document.querySelector(".theme-toggle-label");

  function applyTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    document.body.setAttribute("data-theme", nextTheme);
    const isDark = nextTheme === "dark";

    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(!isDark));
    }

    if (themeToggleIcon) {
      themeToggleIcon.textContent = isDark ? "☀️" : "🌙";
    }

    if (themeToggleLabel) {
      themeToggleLabel.textContent = isDark ? "Light mode" : "Dark mode";
    }

    localStorage.setItem("theme", nextTheme);
  }

  const preferredTheme =
    localStorage.getItem("theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
  applyTheme(preferredTheme);

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const currentTheme =
        document.body.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(currentTheme === "dark" ? "light" : "dark");
    });
  }

  // Create query buttons
  let uploadedFileName = "";
  const queryButtons = [];

  queryConfigs.forEach(({ label, sql }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.className =
      "query-action-btn py-2 px-4 bg-[#7876cf] border border-transparent text-white font-semibold rounded-lg hover:bg-[#6c68bd] disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed transition";
    button.setAttribute("data-active", "false");
    button.innerText = label;

    button.addEventListener("click", async () => {
      setActiveQueryButton(button);
      if (label === "View all data") {
        await loadAllDataPage(0, allDataPageSize);
        return;
      }
      await runQueryAndRender(sql);
    });

    queryButtons.push(button);
    queryButtonsDiv.appendChild(button);
  });

  function setQueryButtonsEnabled(enabled) {
    queryButtons.forEach((button) => {
      button.disabled = !enabled;
    });
  }

  function setActiveQueryButton(activeButton) {
    queryButtons.forEach((button) => {
      button.setAttribute(
        "data-active",
        button === activeButton ? "true" : "false",
      );
    });
  }

  function buildReader() {
    return uploadedFileName.endsWith(".parquet")
      ? `read_parquet('${uploadedFileName}')`
      : `read_csv_auto('${uploadedFileName}', header=true)`;
  }

  async function refreshSourceTable() {
    const reader = buildReader();

    const countResult = await connection.query(
      `SELECT COUNT(*) AS total_rows FROM ${reader};`,
    );
    const totalRows = Number(countResult.toArray()[0].toJSON().total_rows ?? 0);

    await connection.query(
      `CREATE OR REPLACE TABLE source_data AS SELECT * FROM ${reader} LIMIT ${MAX_UPLOAD_ROWS};`,
    );

    return {
      totalRows,
      isTruncated: totalRows > MAX_UPLOAD_ROWS,
    };
  }

  async function getSourceRowCount() {
    const countResult = await connection.query(
      "SELECT COUNT(*) AS total_rows FROM source_data;",
    );
    return Number(countResult.toArray()[0].toJSON().total_rows ?? 0);
  }

  function renderPaginationControls({
    pageIndex,
    pageSize,
    totalRows,
    onPageChange,
    onPageSizeChange,
  }) {
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePageIndex = Math.min(pageIndex, totalPages - 1);
    const startRow = totalRows === 0 ? 0 : safePageIndex * pageSize + 1;
    const endRow = Math.min((safePageIndex + 1) * pageSize, totalRows);
    const startPage = Math.max(0, Math.min(safePageIndex - 2, totalPages - 5));
    const endPage = Math.min(totalPages, startPage + 5);
    const pageButtons = Array.from({ length: endPage - startPage }, (_, idx) => {
      const pageNumber = startPage + idx + 1;
      const isCurrent = pageNumber - 1 === safePageIndex;
      return `
        <button
          type="button"
          data-page-number="${pageNumber}"
          class="rounded border px-2 py-1 text-[11px] ${
            isCurrent
              ? "border-amber-400 bg-amber-500/20 text-amber-200"
              : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
          }"
        >
          ${pageNumber}
        </button>
      `;
    }).join("");

    const controlsHtml = `
      <div class="mt-4 flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2 text-xs text-gray-300 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <button type="button" data-page-action="prev" ${safePageIndex === 0 ? "disabled" : ""} class="rounded border border-gray-700 bg-gray-900 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-gray-800">Prev</button>
          <div class="flex items-center gap-1.5">${pageButtons}</div>
          <button type="button" data-page-action="next" ${safePageIndex >= totalPages - 1 ? "disabled" : ""} class="rounded border border-gray-700 bg-gray-900 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-gray-800">Next</button>
        </div>
        <label class="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
          Rows per page
          <select data-page-size-select class="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200 outline-none">
            ${PAGE_SIZES.map((size) => `<option value="${size}" ${size === pageSize ? "selected" : ""}>${size}</option>`).join("")}
          </select>
        </label>
        <span class="text-[11px] text-gray-400">${startRow}-${endRow} of ${totalRows.toLocaleString()}</span>
      </div>
    `;

    outputDiv.insertAdjacentHTML("beforeend", controlsHtml);

    const prevButton = outputDiv.querySelector('[data-page-action="prev"]');
    const nextButton = outputDiv.querySelector('[data-page-action="next"]');
    const pageButtonsEls = outputDiv.querySelectorAll('[data-page-number]');
    const pageSizeSelect = outputDiv.querySelector('[data-page-size-select]');

    prevButton?.addEventListener("click", () => {
      if (safePageIndex > 0) {
        onPageChange(safePageIndex - 1);
      }
    });

    nextButton?.addEventListener("click", () => {
      if (safePageIndex < totalPages - 1) {
        onPageChange(safePageIndex + 1);
      }
    });

    pageButtonsEls.forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = Number(button.getAttribute("data-page-number")) - 1;
        onPageChange(nextPage);
      });
    });

    pageSizeSelect?.addEventListener("change", (event) => {
      const nextSize = Number(event.target.value);
      if (Number.isFinite(nextSize) && nextSize > 0) {
        onPageSizeChange(nextSize);
      }
    });
  }

  function renderRows(rows, pagination = null) {
    if (rows.length === 0) {
      outputDiv.innerHTML = "<p>No data found</p>";
      if (pagination) {
        renderPaginationControls(pagination);
      }
      return;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function formatNumber(value, digits = 2) {
      return Number(value).toLocaleString(undefined, {
        maximumFractionDigits: digits,
      });
    }

    function tryParseNumber(rawValue) {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        return rawValue;
      }

      if (typeof rawValue !== "string") {
        return null;
      }

      const text = rawValue.trim();
      if (!text) {
        return null;
      }

      const numericPattern = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
      if (!numericPattern.test(text)) {
        return null;
      }

      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function tryParseDateMs(rawValue) {
      if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
        return rawValue.getTime();
      }

      if (typeof rawValue !== "string") {
        return null;
      }

      const text = rawValue.trim();
      if (!text) {
        return null;
      }

      const hasDateShape =
        text.includes("-") || text.includes("/") || text.includes("T");
      if (!hasDateShape) {
        return null;
      }

      const parsed = Date.parse(text);
      return Number.isNaN(parsed) ? null : parsed;
    }

    function getDateBucketKey(dateMs, granularity) {
      const date = new Date(dateMs);
      if (granularity === "year") {
        return `${date.getUTCFullYear()}`;
      }
      if (granularity === "month") {
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        return `${date.getUTCFullYear()}-${month}`;
      }
      if (granularity === "day") {
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        return `${date.getUTCFullYear()}-${month}-${day}`;
      }

      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      return `${date.getUTCFullYear()}-${month}-${day} ${hour}:00`;
    }

    function buildNumericBuckets(values, bucketCount = 10) {
      const min = Math.min(...values);
      const max = Math.max(...values);

      if (min === max) {
        return [
          {
            label: formatNumber(min),
            count: values.length,
            start: min,
            end: max,
            includeEnd: true,
          },
        ];
      }

      const width = (max - min) / bucketCount;
      const bins = Array.from({ length: bucketCount }, (_, index) => ({
        start: min + width * index,
        end: min + width * (index + 1),
        count: 0,
      }));

      values.forEach((value) => {
        const position = Math.min(
          bucketCount - 1,
          Math.floor((value - min) / width),
        );
        bins[position].count += 1;
      });

      return bins.map((bin, index) => {
        if (index === bucketCount - 1) {
          return {
            label: `${formatNumber(bin.start)} to ${formatNumber(max)}`,
            count: bin.count,
            start: bin.start,
            end: max,
            includeEnd: true,
          };
        }

        return {
          label: `${formatNumber(bin.start)} to ${formatNumber(bin.end)}`,
          count: bin.count,
          start: bin.start,
          end: bin.end,
          includeEnd: false,
        };
      });
    }

    function buildDateBuckets(valuesMs) {
      const sortedValues = [...valuesMs].sort((a, b) => a - b);
      const min = sortedValues[0];
      const max = sortedValues[sortedValues.length - 1];
      const spanDays = (max - min) / (1000 * 60 * 60 * 24);

      let granularity = "hour";
      if (spanDays > 730) {
        granularity = "year";
      } else if (spanDays > 60) {
        granularity = "month";
      } else if (spanDays > 2) {
        granularity = "day";
      }

      const bucketMap = new Map();
      valuesMs.forEach((valueMs) => {
        const key = getDateBucketKey(valueMs, granularity);
        const existing = bucketMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          bucketMap.set(key, { key, label: key, count: 1 });
        }
      });

      return {
        granularity,
        buckets: [...bucketMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map((entry) => entry[1]),
      };
    }

    function getColumnDistribution(profileRows, col) {
      const valueCounts = new Map();
      const numberValues = [];
      const dateValuesMs = [];
      let nullCount = 0;
      let nonNullCount = 0;

      profileRows.forEach((row) => {
        const rawVal = row[col];
        if (rawVal === null || rawVal === undefined) {
          nullCount += 1;
          return;
        }

        nonNullCount += 1;

        const parsedNumber = tryParseNumber(rawVal);
        if (parsedNumber !== null) {
          numberValues.push(parsedNumber);
        }

        const parsedDateMs = tryParseDateMs(rawVal);
        if (parsedDateMs !== null) {
          dateValuesMs.push(parsedDateMs);
        }

        const normalizedValue = String(rawVal);
        valueCounts.set(
          normalizedValue,
          (valueCounts.get(normalizedValue) || 0) + 1,
        );
      });

      const totalRows = profileRows.length;
      const nullPct = totalRows > 0 ? (nullCount / totalRows) * 100 : 0;
      const numericCoverage =
        nonNullCount > 0 ? numberValues.length / nonNullCount : 0;
      const dateCoverage =
        nonNullCount > 0 ? dateValuesMs.length / nonNullCount : 0;
      const isNumeric = numericCoverage >= 0.9;
      const isDate = !isNumeric && dateCoverage >= 0.9;

      if (isNumeric && numberValues.length > 0) {
        const numericBuckets = buildNumericBuckets(numberValues, 10);
        return {
          type: "numeric",
          nullPct,
          bars: numericBuckets.map((item, index) => ({
            key: `n-${index}`,
            label: item.label,
            count: item.count,
            matches: (value) => {
              const parsed = tryParseNumber(value);
              if (parsed === null) {
                return false;
              }

              if (item.includeEnd) {
                return parsed >= item.start && parsed <= item.end;
              }

              return parsed >= item.start && parsed < item.end;
            },
          })),
        };
      }

      if (isDate && dateValuesMs.length > 0) {
        const dateProfile = buildDateBuckets(dateValuesMs);
        return {
          type: "date",
          nullPct,
          bars: dateProfile.buckets.slice(-10).map((item) => ({
            key: item.key,
            label: item.label,
            count: item.count,
            matches: (value) => {
              const parsed = tryParseDateMs(value);
              if (parsed === null) {
                return false;
              }

              return (
                getDateBucketKey(parsed, dateProfile.granularity) === item.key
              );
            },
          })),
        };
      }

      const sortedValues = [...valueCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      );
      const topEntries = sortedValues.slice(0, 10);
      const topSet = new Set(topEntries.map(([value]) => value));
      const otherCount = Math.max(
        0,
        sortedValues.reduce((acc, item) => acc + item[1], 0) -
          topEntries.reduce((acc, item) => acc + item[1], 0),
      );

      const bars = topEntries.map(([value, count]) => ({
        key: `c-${value}`,
        label: value,
        count,
        matches: (rawValue) => String(rawValue) === value,
      }));

      if (otherCount > 0) {
        bars.push({
          key: "c-other",
          label: "(other values)",
          count: otherCount,
          matches: (rawValue) => !topSet.has(String(rawValue)),
        });
      }

      return {
        type: "category",
        nullPct,
        bars,
      };
    }

    function buildMiniColumnChartsHeader(columns, profileRows, activeFilters) {
      let html = `<tr class="border-b border-gray-900">`;

      columns.forEach((col) => {
        const distribution = getColumnDistribution(profileRows, col);
        const bars =
          distribution.bars.length > 0
            ? distribution.bars
            : [
                {
                  key: "empty",
                  label: "(empty)",
                  count: 0,
                  matches: () => false,
                },
              ];
        const maxValue = Math.max(...bars.map((item) => item.count), 1);
        const colorClassByType = {
          numeric: "bg-cyan-500",
          date: "bg-indigo-500",
          category: "bg-emerald-500",
        };
        const barColorClass =
          colorClassByType[distribution.type] || "bg-emerald-500";
        const activeKey = activeFilters[col]?.key;

        // Fixed frame height keeps all mini charts visually uniform.
        let barsHtml = `<div class="flex items-end gap-[2px] h-12 min-h-12 max-h-12">`;
        bars.forEach((bar) => {
          const heightPct = maxValue > 0 ? (bar.count / maxValue) * 100 : 0;
          const renderedHeight = Math.max(8, heightPct);
          const isActive = activeKey === bar.key;
          const activeClass = isActive
            ? "ring-2 ring-amber-400 opacity-100"
            : "opacity-85 hover:opacity-100";

          barsHtml += `<button type="button" data-mini-filter="1" data-col="${escapeHtml(col)}" data-filter-key="${escapeHtml(bar.key)}" class="w-1.5 ${barColorClass} rounded-sm ${activeClass} transition" style="height:${renderedHeight.toFixed(1)}%" title="${escapeHtml(col)} | ${escapeHtml(bar.label)}: ${bar.count.toLocaleString()} rows"></button>`;
        });
        barsHtml += `</div>`;

        html += `<th class="p-2 align-bottom"><div class="h-[88px] min-h-[88px] max-h-[88px] rounded-md border border-gray-800 bg-gray-950/80 px-2 py-1.5 flex flex-col justify-between"><div class="text-[10px] uppercase tracking-wide text-gray-500">${escapeHtml(distribution.type)}</div>${barsHtml}<div class="text-[10px] text-gray-500">null ${distribution.nullPct.toFixed(1)}%</div></div></th>`;
      });

      html += `</tr>`;
      return html;
    }

    function applyFilters(sourceRows, activeFilters) {
      const filters = Object.values(activeFilters);
      if (filters.length === 0) {
        return sourceRows;
      }

      return sourceRows.filter((row) =>
        filters.every((filter) => filter.matches(row[filter.col])),
      );
    }

    function applyGlobalSearch(sourceRows, columns, searchTerm) {
      const normalized = searchTerm.trim().toLowerCase();
      if (!normalized) {
        return sourceRows;
      }

      return sourceRows.filter((row) =>
        columns.some((col) => {
          const raw =
            row[col] !== null && row[col] !== undefined ? row[col] : "null";
          return String(raw).toLowerCase().includes(normalized);
        }),
      );
    }

    function highlightCellValue(rawValue, searchTerm) {
      const valueText = String(rawValue);
      const needle = searchTerm.trim().toLowerCase();

      if (!needle) {
        return escapeHtml(valueText);
      }

      const source = valueText.toLowerCase();
      let position = 0;
      let html = "";

      while (position < valueText.length) {
        const matchIndex = source.indexOf(needle, position);
        if (matchIndex === -1) {
          html += escapeHtml(valueText.slice(position));
          break;
        }

        html += escapeHtml(valueText.slice(position, matchIndex));
        html += `<mark class="bg-amber-300/80 text-gray-950 px-0.5 rounded-sm">${escapeHtml(
          valueText.slice(matchIndex, matchIndex + needle.length),
        )}</mark>`;
        position = matchIndex + needle.length;
      }

      return html;
    }

    const activeFilters = {};
    const profileSampleLimit = 2000;
    const profileRows = rows.slice(0, profileSampleLimit);
    let searchDebounceTimer = null;

    function renderOutput() {
      const columns = Object.keys(rows[0]);
      const rowsAfterMiniFilters = applyFilters(rows, activeFilters);
      const searchTerm = searchInput ? searchInput.value : "";
      const filteredRows = applyGlobalSearch(
        rowsAfterMiniFilters,
        columns,
        searchTerm,
      );
      const miniChartsHeaderHtml = buildMiniColumnChartsHeader(
        columns,
        profileRows,
        activeFilters,
      );

      let html = `<table class="w-full text-left border-collapse"><thead>${miniChartsHeaderHtml}<tr class="border-b border-gray-800 text-gray-400 text-xs uppercase">`;

      columns.forEach((col) => {
        html += `<th class="p-2">${escapeHtml(col)}</th>`;
      });
      html += `</tr></thead><tbody class="font-mono text-xs">`;

      filteredRows.forEach((row) => {
        html += `<tr class="border-b border-gray-900 hover:bg-gray-900/50">`;
        columns.forEach((col) => {
          const val =
            row[col] !== null && row[col] !== undefined ? row[col] : "null";
          html += `<td class="p-2 text-gray-300 truncate max-w-xs">${highlightCellValue(
            val,
            searchTerm,
          )}</td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody></table>`;

      const isSampled = rows.length > profileSampleLimit;
      const sampleNotice = isSampled
        ? `<p class="text-[11px] text-amber-400 mb-2">Mini charts are based on first ${profileSampleLimit.toLocaleString()} rows for speed.</p>`
        : "";

      const paginationSummary = pagination
        ? (() => {
            const totalPages = Math.max(1, Math.ceil(pagination.totalRows / pagination.pageSize));
            const safePageIndex = Math.min(pagination.pageIndex, totalPages - 1);
            const startRow = pagination.totalRows === 0 ? 0 : safePageIndex * pagination.pageSize + 1;
            const endRow = Math.min((safePageIndex + 1) * pagination.pageSize, pagination.totalRows);
            return `
              <div class="mb-3 flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-300">
                <span><span class="text-gray-500">Dataset</span> ${pagination.totalRows.toLocaleString()} rows</span>
                <span><span class="text-gray-500">Page</span> ${safePageIndex + 1}/${totalPages} • ${startRow}-${endRow}</span>
              </div>
            `;
          })()
        : "";

      const activeFilterItems = Object.values(activeFilters);
      const filterSummary =
        activeFilterItems.length > 0
          ? `<div class="mb-3 flex items-center gap-2 flex-wrap"><span class="text-[11px] text-gray-400 uppercase tracking-wide">Active filters</span>${activeFilterItems
              .map(
                (filter) =>
                  `<button type="button" data-remove-filter="1" data-col="${escapeHtml(filter.col)}" class="text-[11px] px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20">${escapeHtml(filter.col)}: ${escapeHtml(filter.label)} x</button>`,
              )
              .join(
                "",
              )}<button type="button" id="clearAllFiltersBtn" class="text-[11px] px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800">Clear all</button></div>`
          : "";

      const emptyNotice =
        filteredRows.length === 0
          ? `<p class="text-[11px] text-rose-300 mb-2">No rows match the current filters.</p>`
          : "";

      outputDiv.innerHTML = `${sampleNotice}${filterSummary}${emptyNotice}${paginationSummary}${html}`;
      if (pagination) {
        renderPaginationControls(pagination);
      }

      const distributionByColumn = {};
      columns.forEach((col) => {
        distributionByColumn[col] = getColumnDistribution(profileRows, col);
      });

      const miniFilterButtons = outputDiv.querySelectorAll(
        "[data-mini-filter='1']",
      );
      miniFilterButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const col = button.getAttribute("data-col");
          const filterKey = button.getAttribute("data-filter-key");
          if (!col || !filterKey) {
            return;
          }

          const distribution = distributionByColumn[col];
          if (!distribution) {
            return;
          }

          const selectedBar = distribution.bars.find(
            (item) => item.key === filterKey,
          );
          if (!selectedBar) {
            return;
          }

          if (activeFilters[col]?.key === selectedBar.key) {
            delete activeFilters[col];
          } else {
            activeFilters[col] = {
              col,
              key: selectedBar.key,
              label: selectedBar.label,
              matches: selectedBar.matches,
            };
          }

          renderOutput();
        });
      });

      const removeFilterButtons = outputDiv.querySelectorAll(
        "[data-remove-filter='1']",
      );
      removeFilterButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const col = button.getAttribute("data-col");
          if (!col) {
            return;
          }

          delete activeFilters[col];
          renderOutput();
        });
      });

      const clearAllFiltersBtn = outputDiv.querySelector("#clearAllFiltersBtn");
      if (clearAllFiltersBtn) {
        clearAllFiltersBtn.addEventListener("click", () => {
          Object.keys(activeFilters).forEach((col) => {
            delete activeFilters[col];
          });
          renderOutput();
        });
      }
    }

    if (searchInput) {
      searchInput.oninput = () => {
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
        }

        searchDebounceTimer = setTimeout(() => {
          renderOutput();
        }, SEARCH_DEBOUNCE_MS);
      };
    }

    renderOutput();
  }

  async function loadAllDataPage(pageIndex, pageSize = allDataPageSize) {
    allDataPageSize = pageSize;
    const totalRows = await getSourceRowCount();
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePageIndex = Math.min(Math.max(0, pageIndex), totalPages - 1);
    const offset = safePageIndex * pageSize;
    const sqlText = `SELECT * FROM source_data LIMIT ${pageSize} OFFSET ${offset};`;

    outputDiv.innerText = `Loading page ${safePageIndex + 1}...`;

    try {
      const queryResult = await connection.query(sqlText);
      const rows = queryResult.toArray().map((row) => row.toJSON());
      renderRows(rows, {
        pageIndex: safePageIndex,
        pageSize,
        totalRows,
        onPageChange: (nextPage) => loadAllDataPage(nextPage, pageSize),
        onPageSizeChange: (nextPageSize) => loadAllDataPage(0, nextPageSize),
      });
    } catch (err) {
      outputDiv.innerText = `Query Error: ${err.message}`;
      console.error(err);
    }
  }

  // Function to run a DuckDB query and render the results in the output div
  async function runQueryAndRender(sqlText, pagination = null) {
    if (!uploadedFileName) {
      outputDiv.innerText = "Please upload a CSV or Parquet file first.";
      return;
    }

    outputDiv.innerText = "Running query...";

    try {
      const queryResult = await connection.query(sqlText);
      const rows = queryResult.toArray().map((row) => row.toJSON());
      renderRows(rows, pagination);
    } catch (err) {
      outputDiv.innerText = `Query Error: ${err.message}`;
      console.error(err);
    }
  }

  setQueryButtonsEnabled(false);

  // Load user uploaded file into DuckDB
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    uploadedFileName = file.name;
    setActiveQueryButton(null);
    outputDiv.innerText = `Hold tight, now loading ${uploadedFileName}...`;

    try {
      // Register the file in DuckDB's virtual filesystem
      await db.registerFileHandle(
        uploadedFileName,
        file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
        true,
      );

      // Refresh the table once after upload so it doesn't need to be done for each query.
      const { totalRows, isTruncated } = await refreshSourceTable();

      // Enable the button so it can be clicked
      setQueryButtonsEnabled(true);
      if (isTruncated) {
        outputDiv.innerText = `Success! ${uploadedFileName} loaded with ${MAX_UPLOAD_ROWS.toLocaleString()} rows (truncated from ${totalRows.toLocaleString()}).`;
      } else {
        outputDiv.innerText = `Success! ${uploadedFileName} has been loaded (${totalRows.toLocaleString()} rows).`;
      }
    } catch (err) {
      setQueryButtonsEnabled(false);
      setActiveQueryButton(null);
      outputDiv.innerText = `Error loading file: ${err.message}`;
    }
  });
  
}

// Run the app on load
startApp();
