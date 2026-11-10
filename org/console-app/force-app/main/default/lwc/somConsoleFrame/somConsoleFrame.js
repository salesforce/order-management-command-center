/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { LightningElement, api } from 'lwc';
import { frameUrl } from './frameUrl';

// Salesforce Order Management Operations Console on an Order Summary record page: frames its Multi-Framework app, opened at this order.
// The app domain lets the org's Lightning pages frame it; Lightning lets the frame load through the
// SOM_Console_App trusted URL.
export default class SomConsoleFrame extends LightningElement {
  @api recordId;
  @api consoleUrl;
  @api view;
  @api height;

  get src() {
    return frameUrl(this.consoleUrl, this.recordId, this.view);
  }

  get frameStyle() {
    return `height: ${Math.max(400, Number(this.height) || 1000)}px`;
  }
}
