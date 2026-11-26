# Products

The one product catalogue every app shares, as plain JSON files in your workspace.

## Layout

| Path | Contents |
| --- | --- |
| `/products` | One file per product (`PRD-0001`, …), MIME `application/vnd.verentis.products.product+json` |
| `/applications/products` | Managed app files: Canvas documents, schemas, templates, scripts |

A product records a `name`, `type` (`goods` or `service`), `sku`, `unit`, `category`, `description`, `listPrice`
(what Sales quotes by default) and `reorderPoint` (where Inventory flags low stock).

## Other apps

Sales and Inventory depend on Products: installing either installs it. Manufacturing uses it when installed.
They read product files and change them only through Products' API (`api.yaml`):

- `create-product` adds a product (a product with the same SKU is returned instead of a second one);
- `update-product` changes given fields, conditionally;
- `find-products` finds products by text, SKU, category or type.

Agents get the same operations as tools.

## Earlier products

Before Products, Sales and Inventory each kept their own product files in `/products`. The home page offers to adopt
them: `scripts/post` (`adopt-products`) rewrites each in the shared format at the same path, so codes and references
stay the same.
