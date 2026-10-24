import "./style.css";
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import worker_js from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";

// Import your modular SQL file using Vite's ?raw loader
import selectAllQuery from "./sql/select_all.sql?raw";

async function initDuckDB() {
  const manualBundles = {
    mvp: {
      mainWorker: worker_js,
      mainModule: duckdb_wasm,
    },
  };

  const bundle = await duckdb.selectBundle(manualBundles);
  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule);

  return db;
}

async function run() {
  const db = await initDuckDB();
  const connection = await db.connect();

  const fileInput = document.getElementById("csvInput");
  const runQueryBtn = document.getElementById("runQueryBtn");
  const searchInput = document.getElementById("searchInput");
  const outputDiv = document.getElementById("output");

  let isDataLoaded = false;
  let allRows = []; // Dito natin ise-save ang buong data para mabilis i-filter
  let columns = []; // Dito natin ise-save ang column names

  // 1. File Ingestion
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    outputDiv.innerText = `Ingesting ${file.name} into DuckDB...`;

    try {
      const fileName = file.name;
      await db.registerFileHandle(
        fileName,
        file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
        true,
      );

      if (fileName.toLowerCase().endsWith(".parquet")) {
        await connection.query(`
          CREATE OR REPLACE TABLE source_data AS 
          SELECT * FROM read_parquet('${fileName}');
        `);
      } else {
        await connection.query(`
          CREATE OR REPLACE TABLE source_data AS 
          SELECT * FROM read_csv_auto('${fileName}', header=true);
        `);
      }

      isDataLoaded = true;
      runQueryBtn.disabled = false;
      outputDiv.innerText = `Success! ${file.name} loaded. Click "Run Query" to display data.`;
    } catch (err) {
      outputDiv.innerText = `Error processing file: ${err.message}`;
      console.error(err);
    }
  });

  // Function para i-render ang table gamit ang filtered data
  function renderTable(dataToRender) {
    if (dataToRender.length === 0) {
      outputDiv.innerHTML = `<p class="text-gray-400 italic">No matching rows found.</p>`;
      return;
    }

    let html = `
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
            ${columns.map((col) => `<th class="py-2.5 px-3 font-semibold">${col}</th>`).join("")}
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-800/60 font-mono text-xs">
    `;

    for (const row of dataToRender) {
      html += `<tr class="hover:bg-gray-900/80 transition-colors">`;
      for (const col of columns) {
        const val = row[col];
        const displayVal =
          val !== null && val !== undefined
            ? val
            : '<span class="text-gray-600 italic">null</span>';
        html += `<td class="py-2 px-3 text-gray-300 truncate max-w-xs">${displayVal}</td>`;
      }
      html += `</tr>`;
    }

    html += `</tbody></table>`;
    outputDiv.innerHTML = html;
  }

  // 2. Execute Query Button Click
  runQueryBtn.addEventListener("click", async () => {
    if (!isDataLoaded) return;

    outputDiv.innerText = "Executing query...";

    try {
      const queryResult = await connection.query(selectAllQuery);
      allRows = queryResult.toArray().map((row) => row.toJSON());

      if (allRows.length === 0) {
        outputDiv.innerHTML = `<p class="text-gray-400 italic">Query returned 0 rows.</p>`;
        return;
      }

      columns = Object.keys(allRows[0]);
      renderTable(allRows);
    } catch (err) {
      outputDiv.innerText = `Query error: ${err.message}`;
      console.error(err);
    }
  });

  // 3. Global Search Input Listener (Real-time filtering)
  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (!searchTerm) {
      renderTable(allRows);
      return;
    }

    // I-filter ang rows kung saan ang search term ay tumutugma sa KAHIT ANONG column value
    const filteredRows = allRows.filter((row) => {
      return columns.some((col) => {
        const val = row[col];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(searchTerm);
      });
    });

    renderTable(filteredRows);
  });
}

run();
