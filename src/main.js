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
  const outputDiv = document.getElementById("output");

  let isDataLoaded = false;

  // 1. Handle file upload & ingestion into DuckDB
  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    outputDiv.innerText = `Ingesting ${file.name} into DuckDB memory...`;

    try {
      const buffer = await file.arrayBuffer();
      const fileName = "uploaded_data.csv";

      await db.registerFileBuffer(fileName, new Uint8Array(buffer));

      await connection.query(`
        CREATE OR REPLACE TABLE source_data AS 
        SELECT * FROM read_csv_auto('${fileName}', header=true);
      `);

      isDataLoaded = true;
      runQueryBtn.disabled = false; // Enable the button
      outputDiv.innerText = `Success! ${file.name} is loaded into DuckDB. Click "Run select_all.sql" to query.`;
    } catch (err) {
      outputDiv.innerText = `Error processing CSV: ${err.message}`;
      console.error(err);
    }
  });

  // 2. Handle button click to execute the modular SQL query
  runQueryBtn.addEventListener("click", async () => {
    if (!isDataLoaded) return;

    outputDiv.innerText = "Executing query...";

    try {
      // Execute the imported modular SQL string
      const queryResult = await connection.query(selectAllQuery);

      // Convert result to JSON array
      const rows = queryResult.toArray().map((row) => row.toJSON());

      if (rows.length === 0) {
        outputDiv.innerHTML = `<p class="text-gray-400 italic">Query returned 0 rows.</p>`;
        return;
      }

      // Extract column names dynamically from the first row
      const columns = Object.keys(rows[0]);

      // Build the HTML Table with Tailwind CSS styling
      let html = `
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b border-gray-800 text-gray-400 text-xs uppercase tracking-wider">
              ${columns.map((col) => `<th class="py-2.5 px-3 font-semibold">${col}</th>`).join("")}
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/60 font-mono text-xs">
      `;

      for (const row of rows) {
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

      html += `
          </tbody>
        </table>
      `;

      outputDiv.innerHTML = html;
    } catch (err) {
      outputDiv.innerText = `Query error: ${err.message}`;
      console.error(err);
    }
  });
}

run();
