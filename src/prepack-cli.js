/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* @flow */

/* eslint-disable no-shadow */

import { CompilerDiagnostic, type ErrorHandlerResult, FatalError } from "./errors.js";
import { type Compatibility, CompatibilityValues } from "./options.js";
import { prepackStdin, prepackFileSync } from "./prepack-node.js";
import type { BabelNodeSourceLocation } from "babel-types";
import fs from "fs";
import v8 from "v8";
import { version } from "../package.json";
import invariant from "./invariant";

// Prepack helper
declare var __residual: any;

function run(
  Object,
  Array,
  console,
  JSON,
  process,
  prepackStdin,
  prepackFileSync,
  FatalError,
  CompatibilityValues,
  fs
) {
  let HELP_STR = `
    input                    The name of the file to run Prepack over (for web please provide the single js bundle file)
    --out                    The name of the output file
    --compatibility          The target environment for Prepack [${CompatibilityValues.map(v => `"${v}"`).join(", ")}]
    --mathRandomSeed         If you want Prepack to evaluate Math.random() calls, please provide a seed.
    --srcmapIn               The input sourcemap filename. If present, Prepack will output a sourcemap that maps from
                             the original file (pre-input sourcemap) to Prepack's output
    --srcmapOut              The output sourcemap filename.
    --maxStackDepth          Specify the maximum call stack depth.
    --timeout                The amount of time in seconds until Prepack should time out.
    --additionalFunctions    Additional functions that should be prepacked (comma separated).
    --abstractEffectsInAdditionalFunctions Experimental flag to allow abstract effectful function calls.
    --lazyObjectsRuntime     Enable lazy objects feature and specify the JS runtime that support this feature.
    --debugNames             Changes the output of Prepack so that for named functions and variables that get emitted into
                             Prepack's output, the original name is appended as a suffix to Prepack's generated identifier.
    --speculate              Enable speculative initialization of modules (for the module system Prepack has builtin
                             knowledge about). Prepack will try to execute all factory functions it is able to.
    --trace                  Traces the order of module initialization.
    --serialize              Serializes the partially evaluated global environment as a program that recreates it.
                             (default = true)
    --check                  Check whole program for diagnostic messages. Do not serialize or produce residual code.
    --residual               Produces the residual program that results after constant folding.
    --profile                Enables console logging of profile information of different phases of prepack.
    --statsFile              The name of the output file where statistics will be written to.
    --heapGraphFilePath      The name of the output file where heap graph will be written to.
    --inlineExpressions      When generating code, tells prepack to avoid naming expressions when they are only used once,
                             and instead inline them where they are used.
    --simpleClosures         When generating code, tells prepack to not defer initializing closures
    --omitInvariants         When generating code, tells prepack to omit writing invariants. (Invariants generated by default.)
    --version                Output the version number.
  `;
  let args = Array.from(process.argv);
  args.splice(0, 2);
  let inputFilenames = [];
  let outputFilename;
  let compatibility: Compatibility;
  let mathRandomSeed;
  let inputSourceMap;
  let outputSourceMap;
  let statsFileName;
  let maxStackDepth: number;
  let timeout: number;
  let additionalFunctions: Array<string>;
  let lazyObjectsRuntime: string;
  let heapGraphFilePath: string;
  let debugInFilePath: string;
  let debugOutFilePath: string;
  let flags = {
    initializeMoreModules: false,
    trace: false,
    debugNames: false,
    omitInvariants: false,
    inlineExpressions: false,
    simpleClosures: false,
    abstractEffectsInAdditionalFunctions: false,
    logStatistics: false,
    logModules: false,
    delayInitializations: false,
    delayUnsupportedRequires: false,
    accelerateUnsupportedRequires: true,
    internalDebug: false,
    debugScopes: false,
    serialize: false,
    residual: false,
    check: false,
    profile: false,
    reactEnabled: false,
    reactOutput: "create-element",
  };

  while (args.length) {
    let arg = args.shift();
    if (!arg.startsWith("--")) {
      inputFilenames.push(arg);
    } else {
      arg = arg.slice(2);
      switch (arg) {
        case "out":
          arg = args.shift();
          outputFilename = arg;
          break;
        case "compatibility":
          arg = args.shift();
          if (!CompatibilityValues.includes(arg)) {
            console.error(`Unsupported compatibility: ${arg}`);
            process.exit(1);
          }
          compatibility = (arg: any);
          break;
        case "mathRandomSeed":
          mathRandomSeed = args.shift();
          break;
        case "srcmapIn":
          inputSourceMap = args.shift();
          break;
        case "srcmapOut":
          outputSourceMap = args.shift();
          break;
        case "statsFile":
          statsFileName = args.shift();
          break;
        case "maxStackDepth":
          let value = args.shift();
          if (isNaN(value)) {
            console.error("Stack depth value must be a number");
            process.exit(1);
          }
          maxStackDepth = parseInt(value, 10);
          break;
        case "timeout":
          let seconds = args.shift();
          if (isNaN(seconds)) {
            console.error("Timeout must be a number");
            process.exit(1);
          }
          timeout = parseInt(seconds, 10) * 1000;
          break;
        case "additionalFunctions":
          let line = args.shift();
          additionalFunctions = line.split(",");
          break;
        case "debugInFilePath":
          debugInFilePath = args.shift();
          break;
        case "debugOutFilePath":
          debugOutFilePath = args.shift();
          break;
        case "lazyObjectsRuntime":
          lazyObjectsRuntime = args.shift();
          break;
        case "heapGraphFilePath":
          heapGraphFilePath = args.shift();
          break;
        case "help":
          console.log(
            "Usage: prepack.js [ -- | input.js ] [ --out output.js ] [ --compatibility jsc ] [ --mathRandomSeed seedvalue ] [ --srcmapIn inputMap ] [ --srcmapOut outputMap ] [ --maxStackDepth depthValue ] [ --timeout seconds ] [ --additionalFunctions fnc1,fnc2,... ] [ --lazyObjectsRuntime lazyObjectsRuntimeName] [ --heapGraphFilePath heapGraphFilePath]" +
              Object.keys(flags).map(s => "[ --" + s + "]").join(" ") +
              "\n" +
              HELP_STR
          );
          return;
        case "version":
          console.log(version);
          return;
        default:
          if (arg in flags) {
            flags[arg] = true;
          } else {
            console.error(`Unknown option: ${arg}`);
            process.exit(1);
          }
      }
    }
  }
  if (!flags.serialize && !flags.residual) flags.serialize = true;
  if (flags.check) {
    flags.serialize = false;
    flags.residual = false;
  }

  let resolvedOptions = Object.assign(
    {},
    {
      compatibility,
      mathRandomSeed,
      inputSourceMapFilename: inputSourceMap,
      errorHandler: errorHandler,
      sourceMaps: !!outputSourceMap,
      maxStackDepth: maxStackDepth,
      timeout: timeout,
      additionalFunctions: additionalFunctions,
      lazyObjectsRuntime: lazyObjectsRuntime,
      heapGraphFormat: "DotLanguage",
      debugInFilePath: debugInFilePath,
      debugOutFilePath: debugOutFilePath,
    },
    flags
  );
  if (
    lazyObjectsRuntime &&
    (resolvedOptions.additionalFunctions || resolvedOptions.delayInitializations || resolvedOptions.inlineExpressions)
  ) {
    console.error(
      "lazy objects feature is incompatible with additionalFunctions, delayInitializations and inlineExpressions options"
    );
    process.exit(1);
  }

  let errors: Map<BabelNodeSourceLocation, CompilerDiagnostic> = new Map();
  function errorHandler(diagnostic: CompilerDiagnostic): ErrorHandlerResult {
    if (diagnostic.location) errors.set(diagnostic.location, diagnostic);
    return "Recover";
  }

  function printDiagnostics() {
    let foundFatal = false;
    if (errors.size > 0) {
      console.error("Errors found while prepacking");
      for (let [loc, error] of errors) {
        let sourceMessage = "";
        switch (loc.source) {
          case "":
            sourceMessage = "In an unknown source file";
            break;
          case "no-filename-specified":
            sourceMessage = "In stdin";
            break;
          default:
            // flow made me do this || ""
            sourceMessage = `In input file ${loc.source || ""}`;
            break;
        }

        foundFatal = foundFatal || error.severity === "FatalError";
        console.error(
          `${sourceMessage}(${loc.start.line}:${loc.start.column +
            1}) ${error.severity} ${error.errorCode}: ${error.message}` +
            ` (https://github.com/facebook/prepack/wiki/${error.errorCode})`
        );
        if (foundFatal) {
          console.error(error.callStack || "");
        }
      }
    }
    return foundFatal;
  }

  try {
    if (inputFilenames.length === 0) {
      prepackStdin(resolvedOptions, processSerializedCode);
      return;
    }
    let serialized = prepackFileSync(inputFilenames, resolvedOptions);
    processSerializedCode(null, serialized);
  } catch (err) {
    //FatalErrors must have generated at least one CompilerDiagnostic.
    if (err instanceof FatalError) {
      invariant(errors.size > 0, "FatalError must generate at least one CompilerDiagnostic");
    } else {
      // if it is not a FatalError, it means prepack failed, and we should display the CompilerDiagnostics and stack trace.
      printDiagnostics();
      console.error(err.stack);
      process.exit(1);
    }
  } finally {
    const foundFatal = printDiagnostics();
    if (foundFatal) process.exit(1);
  }

  function processSerializedCode(err, serialized) {
    //FatalErrors must have generated at least one CompilerDiagnostic.
    if (err && err instanceof FatalError) {
      invariant(errors.size > 0, "FatalError must generate at least one CompilerDiagnostic");
    }
    if (err && !(err instanceof FatalError)) {
      // if it is not a FatalError, it means prepack failed, and we should display the CompilerDiagnostics and stack trace.
      printDiagnostics();
      console.error(err);
      process.exit(1);
    }
    // we print the non-fatal diagnostics. We test again if there is any FatalError-level CompilerDiagnostics that wouldn't have thrown a FatalError.
    const foundFatal = printDiagnostics();
    if (foundFatal) process.exit(1);
    if (serialized) {
      if (serialized.code === "") {
        console.error("Prepack returned empty code.");
        return;
      }
      if (outputFilename) {
        console.log(`Prepacked source code written to ${outputFilename}.`);
        fs.writeFileSync(outputFilename, serialized.code);
      } else {
        console.log(serialized.code);
      }
      if (statsFileName) {
        if (serialized.statistics === undefined || serialized.timingStats === undefined) {
          return;
        }
        let stats = {
          SerializerStatistics: serialized.statistics,
          TimingStatistics: serialized.timingStats,
          MemoryStatistics: v8.getHeapStatistics(),
        };
        fs.writeFileSync(statsFileName, JSON.stringify(stats));
      }
      if (outputSourceMap) {
        fs.writeFileSync(outputSourceMap, serialized.map ? JSON.stringify(serialized.map) : "");
      }
      if (heapGraphFilePath) {
        invariant(serialized.heapGraph);
        fs.writeFileSync(heapGraphFilePath, serialized.heapGraph);
      }
    }
  }

  return true;
}

if (typeof __residual === "function") {
  // If we're running inside of Prepack. This is the residual function we'll
  // want to leave untouched in the final program.
  __residual(
    "boolean",
    run,
    Object,
    Array,
    console,
    JSON,
    process,
    prepackStdin,
    prepackFileSync,
    FatalError,
    CompatibilityValues,
    fs
  );
} else {
  run(Object, Array, console, JSON, process, prepackStdin, prepackFileSync, FatalError, CompatibilityValues, fs);
}
