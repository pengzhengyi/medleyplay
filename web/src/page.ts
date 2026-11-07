/**
 * @file This page's name for remote play: a random id made when the page loads.
 *
 * The page sends it with its event stream and its reports, so the server can tell
 * this page from another of the same account.
 */

import { newId } from "./ids";

/** This page's id, such as `0f8fad5b-d9cb-469f-a165-70867728950e`. */
export const PAGE_ID = newId();
