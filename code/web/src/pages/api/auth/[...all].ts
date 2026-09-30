import {env} from "quiescent:runtime";
import type {APIRoute} from "astro";
import {passwordGate} from "../../../writing/auth";
export const ALL:APIRoute=({request})=>passwordGate(request,env);
