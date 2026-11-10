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
@IsTest
private class SomConsoleConnectTest {
    // Stock and delivery estimates take only the fields om-core.js sends; anything else is refused before any lookup runs.
    @IsTest
    static void buildsInventoryAndEstimateLookupsFromWhatTheConsoleSendsOnly() {
        ConnectApi.OCIGetInventoryAvailabilityInputRepresentation i = SomConsoleConnect.inventoryInput((Map<String, Object>) JSON.deserializeUntyped(
            '{"locationIdentifiers":["0160"],"stockKeepingUnits":["6010013-6","6010002-1"]}'));
        System.assertEquals(2, i.stockKeepingUnits.size());
        ConnectApi.EstimateDeliveryDateInputRepresentation e = SomConsoleConnect.estimateInput((Map<String, Object>) JSON.deserializeUntyped(
            '{"shippingCarrier":{"externalReference":"carrierName","shippingCarrierMethods":[{"externalReference":"002"}]},"products":[{"stockKeepingUnit":"6010018","quantity":1}],"deliveryAddress":{"country":"US","postalCode":"94105"}}'));
        System.assertEquals(1, e.products.size());
        for (String bad : new List<String>{ '{"stockKeepingUnits":["A"],"useCache":false}', '{"locationIdentifiers":["0160"]}', '{"stockKeepingUnits":[1]}' }) {
            try { SomConsoleConnect.inventoryInput(JSON.deserializeUntyped(bad)); System.assert(false, bad); } catch (IllegalArgumentException x) { System.assert(x.getMessage() != null); }
        }
        for (String bad : new List<String>{ '{"shippingCarrier":{"externalReference":"c","shippingCarrierMethods":[]},"products":[],"excludeLocations":["x"]}',
                '{"shippingCarrier":{"externalReference":"c","shippingCarrierMethods":[{"id":"1"}]},"products":[]}' }) {
            try { SomConsoleConnect.estimateInput(JSON.deserializeUntyped(bad)); System.assert(false, bad); } catch (IllegalArgumentException x) { System.assert(x.getMessage() != null); }
        }
        // Through the batch: a refused lookup is its own 400, and a bad setup reference never runs.
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        RestContext.request.requestBody = Blob.valueOf('{"items":[{"inventory":{"stockKeepingUnits":["A"],"useCache":false}},{"estimate":{"setup":"bad ref!","input":{}}},{"inventory":{"stockKeepingUnits":["A"]}},{"estimate":{"setup":"alpine","input":{"shippingCarrier":{"externalReference":"c","shippingCarrierMethods":[]},"products":[]}}}]}');
        SomConsoleRead.batch();
        List<Object> results = (List<Object>) ((Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString())).get('results');
        System.assertEquals(4, results.size());
        System.assertEquals(400, ((Map<String, Object>) results[0]).get('status'));
        System.assertEquals(400, ((Map<String, Object>) results[1]).get('status'));
    }
}
