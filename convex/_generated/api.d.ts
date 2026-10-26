/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as operations from "../operations.js";
import type * as performance from "../performance.js";
import type * as players from "../players.js";
import type * as sponsorEmails from "../sponsorEmails.js";
import type * as sponsorPayments from "../sponsorPayments.js";
import type * as sponsors from "../sponsors.js";
import type * as tacticalValues from "../tacticalValues.js";
import type * as tactics from "../tactics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  cleanup: typeof cleanup;
  crons: typeof crons;
  http: typeof http;
  operations: typeof operations;
  performance: typeof performance;
  players: typeof players;
  sponsorEmails: typeof sponsorEmails;
  sponsorPayments: typeof sponsorPayments;
  sponsors: typeof sponsors;
  tacticalValues: typeof tacticalValues;
  tactics: typeof tactics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
