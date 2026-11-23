// Generated from the matter contracts.
export const initial = {
  "$schema": "https://schemas.verentis.io/legal-matters/v1/matter.schema.json",
  "schemaVersion": 1,
  "kind": "matter",
  "id": "{{ id }}",
  "state": "active",
  "createdAt": "{{ now }}",
  "updatedAt": "{{ now }}",
  "code": "",
  "revision": "{{ id }}",
  "pilot": "synthetic-only",
  "title": "{{ name }}",
  "status": "intake",
  "parties": [],
  "team": [],
  "links": [],
  "project": "",
  "engagement": "",
  "currency": "ZAR",
  "rates": [],
  "fixedFee": "",
  "reviewBy": "",
  "reviewReason": "",
  "disposition": "undecided",
  "charges": [],
  "billingReviewer": "",
  "chronology": [],
  "invoices": []
}
export const editable = {
  "team": {
    "type": "array",
    "items": {
      "type": "string",
      "maxLength": 200
    },
    "minItems": 0,
    "maxItems": 100
  },
  "links": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "kind": {
          "enum": [
            "document",
            "task",
            "deadline"
          ]
        },
        "description": {
          "type": "string",
          "maxLength": 500
        },
        "path": {
          "type": "string",
          "maxLength": 4096,
          "pattern": "^(/.*)?$"
        },
        "date": {
          "type": "string",
          "pattern": "^([0-9]{4}-[0-9]{2}-[0-9]{2})?$"
        }
      },
      "required": [
        "kind",
        "description",
        "path",
        "date"
      ],
      "additionalProperties": false
    },
    "minItems": 0,
    "maxItems": 200
  },
  "charges": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "source": {
          "enum": [
            "time",
            "recoverable-expense",
            "fixed-fee"
          ]
        },
        "path": {
          "type": "string",
          "maxLength": 4096,
          "pattern": "^(/.*)?$"
        },
        "release": {
          "type": "string",
          "maxLength": 500
        },
        "writeDown": {
          "type": "string",
          "pattern": "^((0|[1-9][0-9]{0,14})(\\.[0-9]{1,4})?)?$"
        },
        "reason": {
          "type": "string",
          "maxLength": 500
        },
        "recoverability": {
          "type": "string",
          "maxLength": 500
        }
      },
      "required": [
        "source",
        "path",
        "release",
        "writeDown",
        "reason",
        "recoverability"
      ],
      "additionalProperties": false
    },
    "minItems": 0,
    "maxItems": 100
  },
  "billingReviewer": {
    "type": "string",
    "maxLength": 200
  },
  "title": {
    "type": "string",
    "maxLength": 200
  },
  "parties": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "role": {
          "enum": [
            "client",
            "counterparty",
            "related"
          ]
        },
        "name": {
          "type": "string",
          "maxLength": 200
        },
        "crm": {
          "type": "string",
          "maxLength": 4096,
          "pattern": "^(/.*)?$"
        },
        "aliases": {
          "type": "string",
          "maxLength": 1000
        }
      },
      "required": [
        "role",
        "name",
        "crm",
        "aliases"
      ],
      "additionalProperties": false
    },
    "minItems": 0,
    "maxItems": 100
  },
  "project": {
    "type": "string",
    "maxLength": 4096,
    "pattern": "^(/.*)?$"
  },
  "engagement": {
    "type": "string",
    "maxLength": 5000
  },
  "currency": {
    "type": "string",
    "pattern": "^[A-Z]{3}$"
  },
  "rates": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "employee": {
          "type": "string",
          "maxLength": 200
        },
        "effective": {
          "type": "string",
          "pattern": "^([0-9]{4}-[0-9]{2}-[0-9]{2})?$"
        },
        "amount": {
          "type": "string",
          "pattern": "^((0|[1-9][0-9]{0,14})(\\.[0-9]{1,4})?)?$"
        }
      },
      "required": [
        "employee",
        "effective",
        "amount"
      ],
      "additionalProperties": false
    },
    "minItems": 0,
    "maxItems": 100
  },
  "fixedFee": {
    "type": "string",
    "pattern": "^((0|[1-9][0-9]{0,14})(\\.[0-9]{1,4})?)?$"
  },
  "reviewBy": {
    "type": "string",
    "maxLength": 200
  },
  "disposition": {
    "enum": [
      "undecided",
      "clear",
      "waiver-reviewed",
      "decline"
    ]
  },
  "reviewReason": {
    "type": "string",
    "maxLength": 2000
  }
}
