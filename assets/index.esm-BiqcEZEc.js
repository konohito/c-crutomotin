const ae=()=>{};var F={};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const q=function(t){const e=[];let r=0;for(let n=0;n<t.length;n++){let s=t.charCodeAt(n);s<128?e[r++]=s:s<2048?(e[r++]=s>>6|192,e[r++]=s&63|128):(s&64512)===55296&&n+1<t.length&&(t.charCodeAt(n+1)&64512)===56320?(s=65536+((s&1023)<<10)+(t.charCodeAt(++n)&1023),e[r++]=s>>18|240,e[r++]=s>>12&63|128,e[r++]=s>>6&63|128,e[r++]=s&63|128):(e[r++]=s>>12|224,e[r++]=s>>6&63|128,e[r++]=s&63|128)}return e},ce=function(t){const e=[];let r=0,n=0;for(;r<t.length;){const s=t[r++];if(s<128)e[n++]=String.fromCharCode(s);else if(s>191&&s<224){const i=t[r++];e[n++]=String.fromCharCode((s&31)<<6|i&63)}else if(s>239&&s<365){const i=t[r++],o=t[r++],h=t[r++],c=((s&7)<<18|(i&63)<<12|(o&63)<<6|h&63)-65536;e[n++]=String.fromCharCode(55296+(c>>10)),e[n++]=String.fromCharCode(56320+(c&1023))}else{const i=t[r++],o=t[r++];e[n++]=String.fromCharCode((s&15)<<12|(i&63)<<6|o&63)}}return e.join("")},X={byteToCharMap_:null,charToByteMap_:null,byteToCharMapWebSafe_:null,charToByteMapWebSafe_:null,ENCODED_VALS_BASE:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",get ENCODED_VALS(){return this.ENCODED_VALS_BASE+"+/="},get ENCODED_VALS_WEBSAFE(){return this.ENCODED_VALS_BASE+"-_."},HAS_NATIVE_SUPPORT:typeof atob=="function",encodeByteArray(t,e){if(!Array.isArray(t))throw Error("encodeByteArray takes an array as a parameter");this.init_();const r=e?this.byteToCharMapWebSafe_:this.byteToCharMap_,n=[];for(let s=0;s<t.length;s+=3){const i=t[s],o=s+1<t.length,h=o?t[s+1]:0,c=s+2<t.length,l=c?t[s+2]:0,k=i>>2,g=(i&3)<<4|h>>4;let E=(h&15)<<2|l>>6,_=l&63;c||(_=64,o||(E=64)),n.push(r[k],r[g],r[E],r[_])}return n.join("")},encodeString(t,e){return this.HAS_NATIVE_SUPPORT&&!e?btoa(t):this.encodeByteArray(q(t),e)},decodeString(t,e){return this.HAS_NATIVE_SUPPORT&&!e?atob(t):ce(this.decodeStringToByteArray(t,e))},decodeStringToByteArray(t,e){this.init_();const r=e?this.charToByteMapWebSafe_:this.charToByteMap_,n=[];for(let s=0;s<t.length;){const i=r[t.charAt(s++)],h=s<t.length?r[t.charAt(s)]:0;++s;const l=s<t.length?r[t.charAt(s)]:64;++s;const g=s<t.length?r[t.charAt(s)]:64;if(++s,i==null||h==null||l==null||g==null)throw new he;const E=i<<2|h>>4;if(n.push(E),l!==64){const _=h<<4&240|l>>2;if(n.push(_),g!==64){const oe=l<<6&192|g;n.push(oe)}}}return n},init_(){if(!this.byteToCharMap_){this.byteToCharMap_={},this.charToByteMap_={},this.byteToCharMapWebSafe_={},this.charToByteMapWebSafe_={};for(let t=0;t<this.ENCODED_VALS.length;t++)this.byteToCharMap_[t]=this.ENCODED_VALS.charAt(t),this.charToByteMap_[this.byteToCharMap_[t]]=t,this.byteToCharMapWebSafe_[t]=this.ENCODED_VALS_WEBSAFE.charAt(t),this.charToByteMapWebSafe_[this.byteToCharMapWebSafe_[t]]=t,t>=this.ENCODED_VALS_BASE.length&&(this.charToByteMap_[this.ENCODED_VALS_WEBSAFE.charAt(t)]=t,this.charToByteMapWebSafe_[this.ENCODED_VALS.charAt(t)]=t)}}};class he extends Error{constructor(){super(...arguments),this.name="DecodeBase64StringError"}}const le=function(t){const e=q(t);return X.encodeByteArray(e,!0)},v=function(t){return le(t).replace(/\./g,"")},de=function(t){try{return X.decodeString(t,!0)}catch(e){console.error("base64Decode failed: ",e)}return null};/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function fe(){if(typeof self<"u")return self;if(typeof window<"u")return window;if(typeof global<"u")return global;throw new Error("Unable to locate global object.")}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ue=()=>fe().__FIREBASE_DEFAULTS__,pe=()=>{if(typeof process>"u"||typeof F>"u")return;const t=F.__FIREBASE_DEFAULTS__;if(t)return JSON.parse(t)},me=()=>{if(typeof document>"u")return;let t;try{t=document.cookie.match(/__FIREBASE_DEFAULTS__=([^;]+)/)}catch{return}const e=t&&de(t[1]);return e&&JSON.parse(e)},D=()=>{try{return ae()||ue()||pe()||me()}catch(t){console.info(`Unable to get __FIREBASE_DEFAULTS__ due to: ${t}`);return}},ge=t=>{var e,r;return(r=(e=D())==null?void 0:e.emulatorHosts)==null?void 0:r[t]},Pt=t=>{const e=ge(t);if(!e)return;const r=e.lastIndexOf(":");if(r<=0||r+1===e.length)throw new Error(`Invalid host ${e} with no separate hostname and port!`);const n=parseInt(e.substring(r+1),10);return e[0]==="["?[e.substring(1,r-1),n]:[e.substring(0,r),n]},Q=()=>{var t;return(t=D())==null?void 0:t.config},xt=t=>{var e;return(e=D())==null?void 0:e[`_${t}`]};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class be{constructor(){this.reject=()=>{},this.resolve=()=>{},this.promise=new Promise((e,r)=>{this.resolve=e,this.reject=r})}wrapCallback(e){return(r,n)=>{r?this.reject(r):this.resolve(n),typeof e=="function"&&(this.promise.catch(()=>{}),e.length===1?e(r):e(r,n))}}}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ht(t,e){if(t.uid)throw new Error('The "uid" field is no longer supported by mockUserToken. Please use "sub" instead for Firebase Auth User ID.');const r={alg:"none",type:"JWT"},n=e||"demo-project",s=t.iat||0,i=t.sub||t.user_id;if(!i)throw new Error("mockUserToken must contain 'sub' or 'user_id' field!");const o={iss:`https://securetoken.google.com/${n}`,aud:n,iat:s,exp:s+3600,auth_time:s,sub:i,user_id:i,firebase:{sign_in_provider:"custom",identities:{}},...t};return[v(JSON.stringify(r)),v(JSON.stringify(o)),""].join(".")}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Z(){return typeof navigator<"u"&&typeof navigator.userAgent=="string"?navigator.userAgent:""}function Lt(){return typeof window<"u"&&!!(window.cordova||window.phonegap||window.PhoneGap)&&/ios|iphone|ipod|ipad|android|blackberry|iemobile/i.test(Z())}function ee(){var e;const t=(e=D())==null?void 0:e.forceEnvironment;if(t==="node")return!0;if(t==="browser")return!1;try{return Object.prototype.toString.call(global.process)==="[object process]"}catch{return!1}}function kt(){return typeof navigator<"u"&&navigator.userAgent==="Cloudflare-Workers"}function Ft(){const t=typeof chrome=="object"?chrome.runtime:typeof browser=="object"?browser.runtime:void 0;return typeof t=="object"&&t.id!==void 0}function Ut(){return typeof navigator=="object"&&navigator.product==="ReactNative"}function jt(){const t=Z();return t.indexOf("MSIE ")>=0||t.indexOf("Trident/")>=0}function zt(){return!ee()&&!!navigator.userAgent&&navigator.userAgent.includes("Safari")&&!navigator.userAgent.includes("Chrome")}function Vt(){return!ee()&&!!navigator.userAgent&&(navigator.userAgent.includes("Safari")||navigator.userAgent.includes("WebKit"))&&!navigator.userAgent.includes("Chrome")}function ye(){try{return typeof indexedDB=="object"}catch{return!1}}function Ee(){return new Promise((t,e)=>{try{let r=!0;const n="validate-browser-context-for-indexeddb-analytics-module",s=self.indexedDB.open(n);s.onsuccess=()=>{s.result.close(),r||self.indexedDB.deleteDatabase(n),t(!0)},s.onupgradeneeded=()=>{r=!1},s.onerror=()=>{var i;e(((i=s.error)==null?void 0:i.message)||"")}}catch(r){e(r)}})}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const _e="FirebaseError";class y extends Error{constructor(e,r,n){super(r),this.code=e,this.customData=n,this.name=_e,Object.setPrototypeOf(this,y.prototype),Error.captureStackTrace&&Error.captureStackTrace(this,te.prototype.create)}}class te{constructor(e,r,n){this.service=e,this.serviceName=r,this.errors=n}create(e,...r){const n=r[0]||{},s=`${this.service}/${e}`,i=this.errors[e],o=i?ve(i,n):"Error",h=`${this.serviceName}: ${o} (${s}).`;return new y(s,h,n)}}function ve(t,e){return t.replace(Ie,(r,n)=>{const s=e[n];return s!=null?String(s):`<${n}?>`})}const Ie=/\{\$([^}]+)}/g;function Wt(t){for(const e in t)if(Object.prototype.hasOwnProperty.call(t,e))return!1;return!0}function M(t,e){if(t===e)return!0;const r=Object.keys(t),n=Object.keys(e);for(const s of r){if(!n.includes(s))return!1;const i=t[s],o=e[s];if(U(i)&&U(o)){if(!M(i,o))return!1}else if(i!==o)return!1}for(const s of n)if(!r.includes(s))return!1;return!0}function U(t){return t!==null&&typeof t=="object"}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Gt(t){const e=[];for(const[r,n]of Object.entries(t))Array.isArray(n)?n.forEach(s=>{e.push(encodeURIComponent(r)+"="+encodeURIComponent(s))}):e.push(encodeURIComponent(r)+"="+encodeURIComponent(n));return e.length?"&"+e.join("&"):""}function Jt(t){const e={};return t.replace(/^\?/,"").split("&").forEach(n=>{if(n){const[s,i]=n.split("=");e[decodeURIComponent(s)]=decodeURIComponent(i)}}),e}function Kt(t){const e=t.indexOf("?");if(!e)return"";const r=t.indexOf("#",e);return t.substring(e,r>0?r:void 0)}function Yt(t,e){const r=new we(t,e);return r.subscribe.bind(r)}class we{constructor(e,r){this.observers=[],this.unsubscribes=[],this.observerCount=0,this.task=Promise.resolve(),this.finalized=!1,this.onNoObservers=r,this.task.then(()=>{e(this)}).catch(n=>{this.error(n)})}next(e){this.forEachObserver(r=>{r.next(e)})}error(e){this.forEachObserver(r=>{r.error(e)}),this.close(e)}complete(){this.forEachObserver(e=>{e.complete()}),this.close()}subscribe(e,r,n){let s;if(e===void 0&&r===void 0&&n===void 0)throw new Error("Missing Observer.");De(e,["next","error","complete"])?s=e:s={next:e,error:r,complete:n},s.next===void 0&&(s.next=S),s.error===void 0&&(s.error=S),s.complete===void 0&&(s.complete=S);const i=this.unsubscribeOne.bind(this,this.observers.length);return this.finalized&&this.task.then(()=>{try{this.finalError?s.error(this.finalError):s.complete()}catch{}}),this.observers.push(s),i}unsubscribeOne(e){this.observers===void 0||this.observers[e]===void 0||(delete this.observers[e],this.observerCount-=1,this.observerCount===0&&this.onNoObservers!==void 0&&this.onNoObservers(this))}forEachObserver(e){if(!this.finalized)for(let r=0;r<this.observers.length;r++)this.sendOne(r,e)}sendOne(e,r){this.task.then(()=>{if(this.observers!==void 0&&this.observers[e]!==void 0)try{r(this.observers[e])}catch(n){typeof console<"u"&&console.error&&console.error(n)}})}close(e){this.finalized||(this.finalized=!0,e!==void 0&&(this.finalError=e),this.task.then(()=>{this.observers=void 0,this.onNoObservers=void 0}))}}function De(t,e){if(typeof t!="object"||t===null)return!1;for(const r of e)if(r in t&&typeof t[r]=="function")return!0;return!1}function S(){}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function qt(t){return t&&t._delegate?t._delegate:t}/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Xt(t){try{return(t.startsWith("http://")||t.startsWith("https://")?new URL(t).hostname:t).endsWith(".cloudworkstations.dev")}catch{return!1}}async function Qt(t){return(await fetch(t,{credentials:"include"})).ok}class I{constructor(e,r,n){this.name=e,this.instanceFactory=r,this.type=n,this.multipleInstances=!1,this.serviceProps={},this.instantiationMode="LAZY",this.onInstanceCreated=null}setInstantiationMode(e){return this.instantiationMode=e,this}setMultipleInstances(e){return this.multipleInstances=e,this}setServiceProps(e){return this.serviceProps=e,this}setInstanceCreatedCallback(e){return this.onInstanceCreated=e,this}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const p="[DEFAULT]";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Se{constructor(e,r){this.name=e,this.container=r,this.component=null,this.instances=new Map,this.instancesDeferred=new Map,this.instancesOptions=new Map,this.onInitCallbacks=new Map}get(e){const r=this.normalizeInstanceIdentifier(e);if(!this.instancesDeferred.has(r)){const n=new be;if(this.instancesDeferred.set(r,n),this.isInitialized(r)||this.shouldAutoInitialize())try{const s=this.getOrInitializeService({instanceIdentifier:r});s&&n.resolve(s)}catch{}}return this.instancesDeferred.get(r).promise}getImmediate(e){const r=this.normalizeInstanceIdentifier(e==null?void 0:e.identifier),n=(e==null?void 0:e.optional)??!1;if(this.isInitialized(r)||this.shouldAutoInitialize())try{return this.getOrInitializeService({instanceIdentifier:r})}catch(s){if(n)return null;throw s}else{if(n)return null;throw Error(`Service ${this.name} is not available`)}}getComponent(){return this.component}setComponent(e){if(e.name!==this.name)throw Error(`Mismatching Component ${e.name} for Provider ${this.name}.`);if(this.component)throw Error(`Component for ${this.name} has already been provided`);if(this.component=e,!!this.shouldAutoInitialize()){if(Ae(e))try{this.getOrInitializeService({instanceIdentifier:p})}catch{}for(const[r,n]of this.instancesDeferred.entries()){const s=this.normalizeInstanceIdentifier(r);try{const i=this.getOrInitializeService({instanceIdentifier:s});n.resolve(i)}catch{}}}}clearInstance(e=p){this.instancesDeferred.delete(e),this.instancesOptions.delete(e),this.instances.delete(e)}async delete(){const e=Array.from(this.instances.values());await Promise.all([...e.filter(r=>"INTERNAL"in r).map(r=>r.INTERNAL.delete()),...e.filter(r=>"_delete"in r).map(r=>r._delete())])}isComponentSet(){return this.component!=null}isInitialized(e=p){return this.instances.has(e)}getOptions(e=p){return this.instancesOptions.get(e)||{}}initialize(e={}){const{options:r={}}=e,n=this.normalizeInstanceIdentifier(e.instanceIdentifier);if(this.isInitialized(n))throw Error(`${this.name}(${n}) has already been initialized`);if(!this.isComponentSet())throw Error(`Component ${this.name} has not been registered yet`);const s=this.getOrInitializeService({instanceIdentifier:n,options:r});for(const[i,o]of this.instancesDeferred.entries()){const h=this.normalizeInstanceIdentifier(i);n===h&&o.resolve(s)}return s}onInit(e,r){const n=this.normalizeInstanceIdentifier(r),s=this.onInitCallbacks.get(n)??new Set;s.add(e),this.onInitCallbacks.set(n,s);const i=this.instances.get(n);return i&&e(i,n),()=>{s.delete(e)}}invokeOnInitCallbacks(e,r){const n=this.onInitCallbacks.get(r);if(n)for(const s of n)try{s(e,r)}catch{}}getOrInitializeService({instanceIdentifier:e,options:r={}}){let n=this.instances.get(e);if(!n&&this.component&&(n=this.component.instanceFactory(this.container,{instanceIdentifier:Ce(e),options:r}),this.instances.set(e,n),this.instancesOptions.set(e,r),this.invokeOnInitCallbacks(n,e),this.component.onInstanceCreated))try{this.component.onInstanceCreated(this.container,e,n)}catch{}return n||null}normalizeInstanceIdentifier(e=p){return this.component?this.component.multipleInstances?e:p:e}shouldAutoInitialize(){return!!this.component&&this.component.instantiationMode!=="EXPLICIT"}}function Ce(t){return t===p?void 0:t}function Ae(t){return t.instantiationMode==="EAGER"}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Be{constructor(e){this.name=e,this.providers=new Map}addComponent(e){const r=this.getProvider(e.name);if(r.isComponentSet())throw new Error(`Component ${e.name} has already been registered with ${this.name}`);r.setComponent(e)}addOrOverwriteComponent(e){this.getProvider(e.name).isComponentSet()&&this.providers.delete(e.name),this.addComponent(e)}getProvider(e){if(this.providers.has(e))return this.providers.get(e);const r=new Se(e,this);return this.providers.set(e,r),r}getProviders(){return Array.from(this.providers.values())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var a;(function(t){t[t.DEBUG=0]="DEBUG",t[t.VERBOSE=1]="VERBOSE",t[t.INFO=2]="INFO",t[t.WARN=3]="WARN",t[t.ERROR=4]="ERROR",t[t.SILENT=5]="SILENT"})(a||(a={}));const Oe={debug:a.DEBUG,verbose:a.VERBOSE,info:a.INFO,warn:a.WARN,error:a.ERROR,silent:a.SILENT},Te=a.INFO,Me={[a.DEBUG]:"log",[a.VERBOSE]:"log",[a.INFO]:"info",[a.WARN]:"warn",[a.ERROR]:"error"},Ne=(t,e,...r)=>{if(e<t.logLevel)return;const n=new Date().toISOString(),s=Me[e];if(s)console[s](`[${n}]  ${t.name}:`,...r);else throw new Error(`Attempted to log a message with an invalid logType (value: ${e})`)};class Re{constructor(e){this.name=e,this._logLevel=Te,this._logHandler=Ne,this._userLogHandler=null}get logLevel(){return this._logLevel}set logLevel(e){if(!(e in a))throw new TypeError(`Invalid value "${e}" assigned to \`logLevel\``);this._logLevel=e}setLogLevel(e){this._logLevel=typeof e=="string"?Oe[e]:e}get logHandler(){return this._logHandler}set logHandler(e){if(typeof e!="function")throw new TypeError("Value assigned to `logHandler` must be a function");this._logHandler=e}get userLogHandler(){return this._userLogHandler}set userLogHandler(e){this._userLogHandler=e}debug(...e){this._userLogHandler&&this._userLogHandler(this,a.DEBUG,...e),this._logHandler(this,a.DEBUG,...e)}log(...e){this._userLogHandler&&this._userLogHandler(this,a.VERBOSE,...e),this._logHandler(this,a.VERBOSE,...e)}info(...e){this._userLogHandler&&this._userLogHandler(this,a.INFO,...e),this._logHandler(this,a.INFO,...e)}warn(...e){this._userLogHandler&&this._userLogHandler(this,a.WARN,...e),this._logHandler(this,a.WARN,...e)}error(...e){this._userLogHandler&&this._userLogHandler(this,a.ERROR,...e),this._logHandler(this,a.ERROR,...e)}}const $e=(t,e)=>e.some(r=>t instanceof r);let j,z;function Pe(){return j||(j=[IDBDatabase,IDBObjectStore,IDBIndex,IDBCursor,IDBTransaction])}function xe(){return z||(z=[IDBCursor.prototype.advance,IDBCursor.prototype.continue,IDBCursor.prototype.continuePrimaryKey])}const re=new WeakMap,N=new WeakMap,ne=new WeakMap,C=new WeakMap,L=new WeakMap;function He(t){const e=new Promise((r,n)=>{const s=()=>{t.removeEventListener("success",i),t.removeEventListener("error",o)},i=()=>{r(f(t.result)),s()},o=()=>{n(t.error),s()};t.addEventListener("success",i),t.addEventListener("error",o)});return e.then(r=>{r instanceof IDBCursor&&re.set(r,t)}).catch(()=>{}),L.set(e,t),e}function Le(t){if(N.has(t))return;const e=new Promise((r,n)=>{const s=()=>{t.removeEventListener("complete",i),t.removeEventListener("error",o),t.removeEventListener("abort",o)},i=()=>{r(),s()},o=()=>{n(t.error||new DOMException("AbortError","AbortError")),s()};t.addEventListener("complete",i),t.addEventListener("error",o),t.addEventListener("abort",o)});N.set(t,e)}let R={get(t,e,r){if(t instanceof IDBTransaction){if(e==="done")return N.get(t);if(e==="objectStoreNames")return t.objectStoreNames||ne.get(t);if(e==="store")return r.objectStoreNames[1]?void 0:r.objectStore(r.objectStoreNames[0])}return f(t[e])},set(t,e,r){return t[e]=r,!0},has(t,e){return t instanceof IDBTransaction&&(e==="done"||e==="store")?!0:e in t}};function ke(t){R=t(R)}function Fe(t){return t===IDBDatabase.prototype.transaction&&!("objectStoreNames"in IDBTransaction.prototype)?function(e,...r){const n=t.call(A(this),e,...r);return ne.set(n,e.sort?e.sort():[e]),f(n)}:xe().includes(t)?function(...e){return t.apply(A(this),e),f(re.get(this))}:function(...e){return f(t.apply(A(this),e))}}function Ue(t){return typeof t=="function"?Fe(t):(t instanceof IDBTransaction&&Le(t),$e(t,Pe())?new Proxy(t,R):t)}function f(t){if(t instanceof IDBRequest)return He(t);if(C.has(t))return C.get(t);const e=Ue(t);return e!==t&&(C.set(t,e),L.set(e,t)),e}const A=t=>L.get(t);function je(t,e,{blocked:r,upgrade:n,blocking:s,terminated:i}={}){const o=indexedDB.open(t,e),h=f(o);return n&&o.addEventListener("upgradeneeded",c=>{n(f(o.result),c.oldVersion,c.newVersion,f(o.transaction),c)}),r&&o.addEventListener("blocked",c=>r(c.oldVersion,c.newVersion,c)),h.then(c=>{i&&c.addEventListener("close",()=>i()),s&&c.addEventListener("versionchange",l=>s(l.oldVersion,l.newVersion,l))}).catch(()=>{}),h}const ze=["get","getKey","getAll","getAllKeys","count"],Ve=["put","add","delete","clear"],B=new Map;function V(t,e){if(!(t instanceof IDBDatabase&&!(e in t)&&typeof e=="string"))return;if(B.get(e))return B.get(e);const r=e.replace(/FromIndex$/,""),n=e!==r,s=Ve.includes(r);if(!(r in(n?IDBIndex:IDBObjectStore).prototype)||!(s||ze.includes(r)))return;const i=async function(o,...h){const c=this.transaction(o,s?"readwrite":"readonly");let l=c.store;return n&&(l=l.index(h.shift())),(await Promise.all([l[r](...h),s&&c.done]))[0]};return B.set(e,i),i}ke(t=>({...t,get:(e,r,n)=>V(e,r)||t.get(e,r,n),has:(e,r)=>!!V(e,r)||t.has(e,r)}));/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class We{constructor(e){this.container=e}getPlatformInfoString(){return this.container.getProviders().map(r=>{if(Ge(r)){const n=r.getImmediate();return`${n.library}/${n.version}`}else return null}).filter(r=>r).join(" ")}}function Ge(t){const e=t.getComponent();return(e==null?void 0:e.type)==="VERSION"}const $="@firebase/app",W="0.15.1";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const d=new Re("@firebase/app"),Je="@firebase/app-compat",Ke="@firebase/analytics-compat",Ye="@firebase/analytics",qe="@firebase/app-check-compat",Xe="@firebase/app-check",Qe="@firebase/auth",Ze="@firebase/auth-compat",et="@firebase/database",tt="@firebase/data-connect",rt="@firebase/database-compat",nt="@firebase/functions",st="@firebase/functions-compat",it="@firebase/installations",ot="@firebase/installations-compat",at="@firebase/messaging",ct="@firebase/messaging-compat",ht="@firebase/performance",lt="@firebase/performance-compat",dt="@firebase/remote-config",ft="@firebase/remote-config-compat",ut="@firebase/storage",pt="@firebase/storage-compat",mt="@firebase/firestore",gt="@firebase/ai",bt="@firebase/firestore-compat",yt="firebase",Et="12.16.0";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const w="[DEFAULT]",_t={[$]:"fire-core",[Je]:"fire-core-compat",[Ye]:"fire-analytics",[Ke]:"fire-analytics-compat",[Xe]:"fire-app-check",[qe]:"fire-app-check-compat",[Qe]:"fire-auth",[Ze]:"fire-auth-compat",[et]:"fire-rtdb",[tt]:"fire-data-connect",[rt]:"fire-rtdb-compat",[nt]:"fire-fn",[st]:"fire-fn-compat",[it]:"fire-iid",[ot]:"fire-iid-compat",[at]:"fire-fcm",[ct]:"fire-fcm-compat",[ht]:"fire-perf",[lt]:"fire-perf-compat",[dt]:"fire-rc",[ft]:"fire-rc-compat",[ut]:"fire-gcs",[pt]:"fire-gcs-compat",[mt]:"fire-fst",[bt]:"fire-fst-compat",[gt]:"fire-vertex","fire-js":"fire-js",[yt]:"fire-js-all"};/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const m=new Map,P=new Map,x=new Map;function G(t,e){try{t.container.addComponent(e)}catch(r){d.debug(`Component ${e.name} failed to register with FirebaseApp ${t.name}`,r)}}function H(t){const e=t.name;if(x.has(e))return d.debug(`There were multiple attempts to register component ${e}.`),!1;x.set(e,t);for(const r of m.values())G(r,t);for(const r of P.values())G(r,t);return!0}function vt(t,e){const r=t.container.getProvider("heartbeat").getImmediate({optional:!0});return r&&r.triggerHeartbeat(),t.container.getProvider(e)}function Zt(t,e,r=w){vt(t,e).clearInstance(r)}function er(t){return t==null?!1:t.settings!==void 0}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const It={"no-app":"No Firebase App '{$appName}' has been created - call initializeApp() first","bad-app-name":"Illegal App name: '{$appName}'","duplicate-app":"Firebase App named '{$appName}' already exists with different options or config","app-deleted":"Firebase App named '{$appName}' already deleted","server-app-deleted":"Firebase Server App has been deleted","no-options":"Need to provide options, when not being deployed to hosting via source.","invalid-app-argument":"firebase.{$appName}() takes either no argument or a Firebase App instance.","invalid-log-argument":"First argument to `onLog` must be null or a function.","idb-open":"Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.","idb-get":"Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.","idb-set":"Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.","idb-delete":"Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.","finalization-registry-not-supported":"FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.","invalid-server-app-environment":"FirebaseServerApp is not for use in browser environments."},u=new te("app","Firebase",It);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class wt{constructor(e,r,n){this._isDeleted=!1,this._options={...e},this._config={...r},this._name=r.name,this._automaticDataCollectionEnabled=r.automaticDataCollectionEnabled,this._container=n,this.container.addComponent(new I("app",()=>this,"PUBLIC"))}get automaticDataCollectionEnabled(){return this.checkDestroyed(),this._automaticDataCollectionEnabled}set automaticDataCollectionEnabled(e){this.checkDestroyed(),this._automaticDataCollectionEnabled=e}get name(){return this.checkDestroyed(),this._name}get options(){return this.checkDestroyed(),this._options}get config(){return this.checkDestroyed(),this._config}get container(){return this._container}get isDeleted(){return this._isDeleted}set isDeleted(e){this._isDeleted=e}checkDestroyed(){if(this.isDeleted)throw u.create("app-deleted",{appName:this._name})}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const tr=Et;function Dt(t,e={}){let r=t;typeof e!="object"&&(e={name:e});const n={name:w,automaticDataCollectionEnabled:!0,...e},s=n.name;if(typeof s!="string"||!s)throw u.create("bad-app-name",{appName:String(s)});if(r||(r=Q()),!r)throw u.create("no-options");const i=m.get(s);if(i){if(M(r,i.options)&&M(n,i.config))return i;throw u.create("duplicate-app",{appName:s})}const o=new Be(s);for(const c of x.values())o.addComponent(c);const h=new wt(r,n,o);return m.set(s,h),h}function rr(t=w){const e=m.get(t);if(!e&&t===w&&Q())return Dt();if(!e)throw u.create("no-app",{appName:t});return e}function nr(){return Array.from(m.values())}async function sr(t){let e=!1;const r=t.name;m.has(r)?(e=!0,m.delete(r)):P.has(r)&&t.decRefCount()<=0&&(P.delete(r),e=!0),e&&(await Promise.all(t.container.getProviders().map(n=>n.delete())),t.isDeleted=!0)}function O(t,e,r){let n=_t[t]??t;r&&(n+=`-${r}`);const s=n.match(/\s|\//),i=e.match(/\s|\//);if(s||i){const o=[`Unable to register library "${n}" with version "${e}":`];s&&o.push(`library name "${n}" contains illegal characters (whitespace or "/")`),s&&i&&o.push("and"),i&&o.push(`version name "${e}" contains illegal characters (whitespace or "/")`),d.warn(o.join(" "));return}H(new I(`${n}-version`,()=>({library:n,version:e}),"VERSION"))}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const St="firebase-heartbeat-database",Ct=1,b="firebase-heartbeat-store";let T=null;function se(){return T||(T=je(St,Ct,{upgrade:(t,e)=>{switch(e){case 0:try{t.createObjectStore(b)}catch(r){console.warn(r)}}}}).catch(t=>{throw u.create("idb-open",{originalErrorMessage:t.message})})),T}async function At(t){try{const r=(await se()).transaction(b),n=await r.objectStore(b).get(ie(t));return await r.done,n}catch(e){if(e instanceof y)d.warn(e.message);else{const r=u.create("idb-get",{originalErrorMessage:e==null?void 0:e.message});d.warn(r.message)}}}async function J(t,e){try{const n=(await se()).transaction(b,"readwrite");await n.objectStore(b).put(e,ie(t)),await n.done}catch(r){if(r instanceof y)d.warn(r.message);else{const n=u.create("idb-set",{originalErrorMessage:r==null?void 0:r.message});d.warn(n.message)}}}function ie(t){return`${t.name}!${t.options.appId}`}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Bt=1024,Ot=30;class Tt{constructor(e){this.container=e,this._heartbeatsCache=null;const r=this.container.getProvider("app").getImmediate();this._storage=new Nt(r),this._heartbeatsCachePromise=this._storage.read().then(n=>(this._heartbeatsCache=n,n))}async triggerHeartbeat(){var e,r;try{const s=this.container.getProvider("platform-logger").getImmediate().getPlatformInfoString(),i=K();if(((e=this._heartbeatsCache)==null?void 0:e.heartbeats)==null&&(this._heartbeatsCache=await this._heartbeatsCachePromise,((r=this._heartbeatsCache)==null?void 0:r.heartbeats)==null)||this._heartbeatsCache.lastSentHeartbeatDate===i||this._heartbeatsCache.heartbeats.some(o=>o.date===i))return;if(this._heartbeatsCache.heartbeats.push({date:i,agent:s}),this._heartbeatsCache.heartbeats.length>Ot){const o=Rt(this._heartbeatsCache.heartbeats);this._heartbeatsCache.heartbeats.splice(o,1)}return this._storage.overwrite(this._heartbeatsCache)}catch(n){d.warn(n)}}async getHeartbeatsHeader(){var e;try{if(this._heartbeatsCache===null&&await this._heartbeatsCachePromise,((e=this._heartbeatsCache)==null?void 0:e.heartbeats)==null||this._heartbeatsCache.heartbeats.length===0)return"";const r=K(),{heartbeatsToSend:n,unsentEntries:s}=Mt(this._heartbeatsCache.heartbeats),i=v(JSON.stringify({version:2,heartbeats:n}));return this._heartbeatsCache.lastSentHeartbeatDate=r,s.length>0?(this._heartbeatsCache.heartbeats=s,await this._storage.overwrite(this._heartbeatsCache)):(this._heartbeatsCache.heartbeats=[],this._storage.overwrite(this._heartbeatsCache)),i}catch(r){return d.warn(r),""}}}function K(){return new Date().toISOString().substring(0,10)}function Mt(t,e=Bt){const r=[];let n=t.slice();for(const s of t){const i=r.find(o=>o.agent===s.agent);if(i){if(i.dates.push(s.date),Y(r)>e){i.dates.pop();break}}else if(r.push({agent:s.agent,dates:[s.date]}),Y(r)>e){r.pop();break}n=n.slice(1)}return{heartbeatsToSend:r,unsentEntries:n}}class Nt{constructor(e){this.app=e,this._canUseIndexedDBPromise=this.runIndexedDBEnvironmentCheck()}async runIndexedDBEnvironmentCheck(){return ye()?Ee().then(()=>!0).catch(()=>!1):!1}async read(){if(await this._canUseIndexedDBPromise){const r=await At(this.app);return r!=null&&r.heartbeats?r:{heartbeats:[]}}else return{heartbeats:[]}}async overwrite(e){if(await this._canUseIndexedDBPromise){const n=await this.read();return J(this.app,{lastSentHeartbeatDate:e.lastSentHeartbeatDate??n.lastSentHeartbeatDate,heartbeats:e.heartbeats})}else return}async add(e){if(await this._canUseIndexedDBPromise){const n=await this.read();return J(this.app,{lastSentHeartbeatDate:e.lastSentHeartbeatDate??n.lastSentHeartbeatDate,heartbeats:[...n.heartbeats,...e.heartbeats]})}else return}}function Y(t){return v(JSON.stringify({version:2,heartbeats:t})).length}function Rt(t){if(t.length===0)return-1;let e=0,r=t[0].date;for(let n=1;n<t.length;n++)t[n].date<r&&(r=t[n].date,e=n);return e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function $t(t){H(new I("platform-logger",e=>new We(e),"PRIVATE")),H(new I("heartbeat",e=>new Tt(e),"PRIVATE")),O($,W,t),O($,W,"esm2020"),O("fire-js","")}$t("");export{Gt as A,xt as B,I as C,w as D,ge as E,y as F,jt as G,Wt as H,de as I,te as J,Lt as K,Re as L,Ut as M,be as N,Ft as O,kt as P,Yt as Q,tr as S,G as _,m as a,x as b,vt as c,sr as d,er as e,H as f,nr as g,Zt as h,Dt as i,P as j,rr as k,a as l,qt as m,Xt as n,M as o,Qt as p,Ht as q,O as r,Pt as s,fe as t,ye as u,Z as v,zt as w,Vt as x,Jt as y,Kt as z};
