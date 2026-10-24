// Import modules
import "./style.css";
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import worker_js from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import selectAllQuery from "./sql/select_all.sql?raw";
import selectAllLimit100Query from "./sql/select_all_limit_100.sql?raw";
import countAllQuery from "./sql/count_all.sql?raw";

async function startApp() {
  const queryConfigs = [
    { label: "View all data", sql: selectAllQuery },
    { label: "View top 100 rows", sql: selectAllLimit100Query },
    { label: "Count rows", sql: countAllQuery },
  ];

  // 1. I-setup at simulan ang DuckDB sa loob ng browser worker
  const worker = new Worker(worker_js);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(duckdb_wasm);
  const connection = await db.connect();

  // 2. Kunin ang mga HTML elements mula sa index.html
  const fileInput = document.getElementById("csvInput");
  const queryButtonsDiv = document.getElementById("queryButtons");
  const outputDiv = document.getElementById("output");

  let uploadedFileName = "";
  const queryButtons = [];

  queryConfigs.forEach(({ label, sql }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.className =
      "py-2 px-4 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed transition";
    button.innerText = label;

    button.addEventListener("click", async () => {
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

  function buildReader() {
    return uploadedFileName.endsWith(".parquet")
      ? `read_parquet('${uploadedFileName}')`
      : `read_csv_auto('${uploadedFileName}', header=true)`;
  }

  async function refreshSourceTable() {
    const reader = buildReader();
    await connection.query(
      `CREATE OR REPLACE TABLE source_data AS SELECT * FROM ${reader};`,
    );
  }

  function renderRows(rows) {
    if (rows.length === 0) {
      outputDiv.innerHTML = "<p>No data found</p>";
      return;
    }

    const columns = Object.keys(rows[0]);
    let html = `<table class="w-full text-left border-collapse"><thead><tr class="border-b border-gray-800 text-gray-400 text-xs uppercase">`;

    columns.forEach((col) => {
      html += `<th class="p-2">${col}</th>`;
    });
    html += `</tr></thead><tbody class="font-mono text-xs">`;

    rows.forEach((row) => {
      html += `<tr class="border-b border-gray-900 hover:bg-gray-900/50">`;
      columns.forEach((col) => {
        const val =
          row[col] !== null && row[col] !== undefined ? row[col] : "null";
        html += `<td class="p-2 text-gray-300 truncate max-w-xs">${val}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;

    outputDiv.innerHTML = html;
  }

  async function runQueryAndRender(sqlText) {
    if (!uploadedFileName) {
      outputDiv.innerText = "Please upload a CSV or Parquet file first.";
      return;
    }

    outputDiv.innerText = "Running query...";

    try {
      const queryResult = await connection.query(sqlText);
      const rows = queryResult.toArray().map((row) => row.toJSON());
      renderRows(rows);
    } catch (err) {
      outputDiv.innerText = `Query Error: ${err.message}`;
      console.error(err);
    }
  }

  setQueryButtonsEnabled(false);

  // 3. Kapag namili ang user ng file (CSV o Parquet)
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    uploadedFileName = file.name;
    outputDiv.innerText = `Now loading ${uploadedFileName}...`;

    try {
      // I-rehistro ang file sa virtual filesystem ng DuckDB
      await db.registerFileHandle(
        uploadedFileName,
        file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
        true,
      );

      // I-refresh ang table isang beses pagkaupload para di na ulit sa bawat query.
      await refreshSourceTable();

      // Paganahin ang button para pwede na itong i-click
      setQueryButtonsEnabled(true);
      outputDiv.innerText = `Success! ${uploadedFileName} has been loaded`;
    } catch (err) {
      setQueryButtonsEnabled(false);
      outputDiv.innerText = `Error loading file: ${err.message}`;
    }
  });
}

// Patakbuhin ang app pagka-load
startApp();
