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
// The two ConnectApi reads SomConsoleRead can run: stock in Omnichannel Inventory and a delivery estimate. Kept in their own
// class because the ConnectApi types behind them exist only in orgs with those features, and a class naming a type its org
// lacks fails to deploy. Deploy this class only where they exist; SomConsoleRead finds it by name and answers 404 without it.
// Read-only like SomConsoleRead: each takes only the fields the console sends and changes nothing.
public with sharing class SomConsoleConnect implements Callable {
    public Object call(String action, Map<String, Object> args) {
        if (action == 'inventory') return inventory(args.get('arg'));
        if (action == 'estimate') return estimate(args.get('arg'));
        throw new IllegalArgumentException('Unknown lookup ' + action);
    }

    // Stock at locations or location groups, as om-core.js asks Omnichannel Inventory's get-availability.
    @TestVisible
    static ConnectApi.OCIGetInventoryAvailabilityInputRepresentation inventoryInput(Object o) {
        Map<String, Object> m = only(o, new Set<String>{ 'locationIdentifiers', 'locationGroupIdentifiers', 'stockKeepingUnits' });
        if (!m.containsKey('stockKeepingUnits')) throw new IllegalArgumentException('Name the SKUs');
        for (Object v : m.values()) {
            for (Object x : listOf(v, 100)) if (!(x instanceof String)) throw new IllegalArgumentException('Expected text');
        }
        return (ConnectApi.OCIGetInventoryAvailabilityInputRepresentation) JSON.deserialize(JSON.serialize(m), ConnectApi.OCIGetInventoryAvailabilityInputRepresentation.class);
    }
    static String inventory(Object o) {
        return JSON.serialize(ConnectApi.OmnichannelInventoryService.getInventoryAvailability(inventoryInput(o)));
    }

    // A delivery estimate for one carrier, as om-core.js asks an estimation setup's estimate-date.
    @TestVisible
    static ConnectApi.EstimateDeliveryDateInputRepresentation estimateInput(Object o) {
        Map<String, Object> m = only(o, new Set<String>{ 'shippingCarrier', 'products', 'deliveryAddress' });
        Map<String, Object> carrier = only(m.get('shippingCarrier'), new Set<String>{ 'externalReference', 'shippingCarrierMethods' });
        for (Object x : listOf(carrier.get('shippingCarrierMethods'), 20)) only(x, new Set<String>{ 'externalReference' });
        for (Object x : listOf(m.get('products'), 100)) only(x, new Set<String>{ 'stockKeepingUnit', 'quantity' });
        if (m.get('deliveryAddress') != null) only(m.get('deliveryAddress'), new Set<String>{ 'country', 'state', 'city', 'postalCode' });
        return (ConnectApi.EstimateDeliveryDateInputRepresentation) JSON.deserialize(JSON.serialize(m), ConnectApi.EstimateDeliveryDateInputRepresentation.class);
    }
    static String estimate(Object o) {
        Map<String, Object> m = only(o, new Set<String>{ 'setup', 'input' });
        if (!(m.get('setup') instanceof String) || !Pattern.matches('[\\w.-]{1,80}', (String) m.get('setup'))) throw new IllegalArgumentException('Bad estimation setup');
        return JSON.serialize(ConnectApi.ExtendedCommerceDelivery.estimateDeliveryDate(estimateInput(m.get('input')), (String) m.get('setup')));
    }

    static Map<String, Object> only(Object o, Set<String> allowed) {
        if (!(o instanceof Map<String, Object>)) throw new IllegalArgumentException('Expected an object');
        Map<String, Object> m = (Map<String, Object>) o;
        for (String k : m.keySet()) if (!allowed.contains(k)) throw new IllegalArgumentException('Unexpected field ' + k);
        return m;
    }
    static List<Object> listOf(Object o, Integer max) {
        if (!(o instanceof List<Object>) || ((List<Object>) o).size() > max) throw new IllegalArgumentException('Expected a list of at most ' + max);
        return (List<Object>) o;
    }
}
