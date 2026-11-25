// Versioned boundary shared with the existing MEHETA Customer Support branch.
// Source JSON is data only. CRM permissions and policy checks remain authoritative.
export const supportPayloadSchema = {
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "eventId": {
      "type": "string",
      "pattern": "^MEHETA-CS-[0-9a-f]{64}$"
    },
    "requestKey": {
      "type": "string",
      "pattern": "^MEHETA-CS-[0-9a-fA-F-]{36}$"
    },
    "revision": {
      "type": "integer",
      "minimum": 1
    },
    "companyId": {
      "type": "string",
      "pattern": "^[0-9a-fA-F-]{36}$"
    },
    "department": {
      "const": "CUSTOMER_SUPPORT"
    },
    "category": {
      "enum": [
        "PRODUCT_ENQUIRY",
        "PRODUCT_SUPPORT",
        "OTHER"
      ]
    },
    "intent": {
      "type": "object",
      "properties": {
        "action": {
          "enum": [
            "ASK_PRICE",
            "ASK_PRODUCT_DETAILS",
            "ASK_PRODUCT_SUITABILITY",
            "REPORT_PRODUCT_ISSUE",
            "REQUEST_WARRANTY",
            "PROVIDE_INVOICE",
            "OTHER"
          ]
        },
        "summary": {
          "type": "string",
          "maxLength": 2000,
          "minLength": 1
        },
        "source": {
          "enum": [
            "LLM",
            "VALIDATION_FALLBACK"
          ]
        }
      },
      "required": [
        "action",
        "summary",
        "source"
      ],
      "additionalProperties": false
    },
    "source": {
      "type": "object",
      "properties": {
        "system": {
          "const": "MAKE_MEHETA_CUSTOMER_SUPPORT"
        },
        "emailId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
        },
        "providerMessageId": {
          "type": "string",
          "maxLength": 200,
          "minLength": 1
        },
        "threadId": {
          "type": "string",
          "maxLength": 200
        },
        "mailbox": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        },
        "senderEmail": {
          "type": "string",
          "format": "email",
          "maxLength": 254
        },
        "subject": {
          "type": "string",
          "maxLength": 2000
        },
        "receivedAt": {
          "type": "string",
          "format": "date-time"
        },
        "originalText": {
          "type": "string",
          "maxLength": 100000
        },
        "attachments": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "filename": {
                "type": "string",
                "maxLength": 160
              },
              "mimeType": {
                "type": "string",
                "maxLength": 200
              },
              "attachmentId": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 300
              },
              "bytes": {
                "type": "integer",
                "minimum": 0
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              },
              "archived": {
                "type": "boolean"
              },
              "readable": {
                "type": "boolean"
              }
            },
            "required": [
              "filename",
              "mimeType",
              "bytes",
              "sha256",
              "archived",
              "readable"
            ],
            "additionalProperties": false
          },
          "maxItems": 200
        },
        "archive": {
          "type": "object",
          "properties": {
            "bucket": {
              "const": "mehetas3"
            },
            "key": {
              "type": "string",
              "pattern": "^MEHETAs/",
              "maxLength": 1024
            },
            "sha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "status": {
              "enum": [
                "AVAILABLE",
                "FAILED"
              ]
            }
          },
          "required": [
            "bucket",
            "key",
            "sha256",
            "status"
          ],
          "additionalProperties": false
        },
        "emailEvidence": {
          "type": "object",
          "properties": {
            "bucket": {
              "const": "mehetas3"
            },
            "key": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^MEHETAs/",
              "maxLength": 1024
            },
            "sha256": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^[0-9a-f]{64}$"
            },
            "bytes": {
              "type": [
                "integer",
                "null"
              ],
              "minimum": 0
            }
          },
          "required": [
            "bucket",
            "key",
            "sha256",
            "bytes"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "system",
        "emailId",
        "providerMessageId",
        "threadId",
        "mailbox",
        "senderEmail",
        "subject",
        "receivedAt",
        "originalText",
        "attachments",
        "archive",
        "emailEvidence"
      ],
      "additionalProperties": false
    },
    "identity": {
      "type": "object",
      "properties": {
        "emailVerificationRequired": {
          "const": false
        },
        "otpRequired": {
          "const": false
        },
        "senderVerified": {
          "const": false
        },
        "contactMatchInformationalOnly": {
          "const": true
        }
      },
      "required": [
        "emailVerificationRequired",
        "otpRequired",
        "senderVerified",
        "contactMatchInformationalOnly"
      ],
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "productCodes": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 300
          },
          "maxItems": 10
        },
        "productNames": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 300
          },
          "maxItems": 10
        },
        "issueDescription": {
          "type": [
            "string",
            "null"
          ],
          "maxLength": 4000
        },
        "serialNumbers": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 200
          },
          "maxItems": 200
        },
        "invoiceNumbers": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 200
          },
          "maxItems": 200
        },
        "attachmentsPresent": {
          "type": "boolean"
        }
      },
      "required": [
        "productCodes",
        "productNames",
        "issueDescription",
        "serialNumbers",
        "invoiceNumbers",
        "attachmentsPresent"
      ],
      "additionalProperties": false
    },
    "products": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "requestedCode": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "requestedName": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "matchStatus": {
            "enum": [
              "MATCHED",
              "NOT_FOUND",
              "AMBIGUOUS_ITEM",
              "PRICE_PROFILE_MISSING",
              "AMBIGUOUS_PRICE_PROFILE"
            ]
          },
          "matchMethod": {
            "enum": [
              "EXACT_CODE",
              "EXACT_NAME",
              null
            ]
          },
          "itemId": {
            "type": [
              "integer",
              "string",
              "null"
            ],
            "pattern": "^[1-9][0-9]*$",
            "minimum": 1
          },
          "profileId": {
            "type": [
              "integer",
              "string",
              "null"
            ],
            "pattern": "^[1-9][0-9]*$",
            "minimum": 1
          },
          "partCode": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "description": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "brand": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "hsn": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "uom": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 10000
          },
          "packSize": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
          },
          "moq": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
          },
          "listPrice": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
          },
          "currency": {
            "enum": [
              "INR",
              null
            ]
          },
          "priceSource": {
            "const": "crm_item_profiles.list_price"
          },
          "priceCheckedAt": {
            "type": "string",
            "format": "date-time"
          },
          "taxIncluded": {
            "type": "null"
          },
          "availability": {
            "type": "null"
          },
          "profileScope": {
            "enum": [
              "COMPANY",
              "GLOBAL_FALLBACK",
              null
            ]
          }
        },
        "required": [
          "requestedCode",
          "requestedName",
          "matchStatus",
          "matchMethod",
          "itemId",
          "profileId",
          "partCode",
          "description",
          "brand",
          "hsn",
          "uom",
          "packSize",
          "moq",
          "listPrice",
          "currency",
          "priceSource",
          "priceCheckedAt",
          "taxIncluded",
          "availability",
          "profileScope"
        ],
        "additionalProperties": false
      },
      "maxItems": 10
    },
    "invoice": {
      "type": "object",
      "properties": {
        "attachmentStatus": {
          "enum": [
            "NOT_APPLICABLE",
            "MISSING",
            "PRESENT",
            "UNREADABLE",
            "NO_INVOICE_DOCUMENT"
          ]
        },
        "extracted": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "sourceFilename": {
                "type": "string",
                "maxLength": 160
              },
              "sourceSha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              },
              "documentType": {
                "enum": [
                  "INVOICE",
                  "OTHER"
                ]
              },
              "invoiceNumber": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "invoiceDate": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date"
              },
              "sellerName": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "sellerGstin": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "buyerName": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "buyerGstin": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "currency": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^[A-Z]{3}$"
              },
              "subtotal": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
              },
              "taxTotal": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
              },
              "total": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
              },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "description": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "maxLength": 10000
                    },
                    "productCode": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "maxLength": 10000
                    },
                    "quantity": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "uom": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "maxLength": 10000
                    },
                    "unitPrice": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "taxableAmount": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "taxRate": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "lineTotal": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "serialNumbers": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "maxLength": 200
                      },
                      "maxItems": 200
                    },
                    "hsnSacCode": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "maxLength": 10000
                    },
                    "discount": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "maxLength": 10000
                    },
                    "cgstRate": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "sgstRate": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "igstRate": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "cgstAmount": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "sgstAmount": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    },
                    "igstAmount": {
                      "type": [
                        "string",
                        "null"
                      ],
                      "pattern": "^\\d{1,14}(?:\\.\\d{1,6})?$"
                    }
                  },
                  "required": [
                    "description",
                    "productCode",
                    "quantity",
                    "uom",
                    "unitPrice",
                    "taxableAmount",
                    "taxRate",
                    "lineTotal",
                    "serialNumbers",
                    "hsnSacCode",
                    "discount",
                    "cgstRate",
                    "sgstRate",
                    "igstRate",
                    "cgstAmount",
                    "sgstAmount",
                    "igstAmount"
                  ],
                  "additionalProperties": false
                },
                "maxItems": 200
              },
              "missingFields": {
                "type": "array",
                "items": {
                  "type": "string",
                  "maxLength": 200
                },
                "maxItems": 200
              },
              "sellerAddress": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "buyerBillingAddress": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "deliveryAddress": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "contactPerson": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "email": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "phone": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "poNumber": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "paymentTerms": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "otherTerms": {
                "type": [
                  "string",
                  "null"
                ],
                "maxLength": 10000
              },
              "invoiceDueDate": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "date"
              }
            },
            "required": [
              "sourceFilename",
              "sourceSha256",
              "documentType",
              "invoiceNumber",
              "invoiceDate",
              "sellerName",
              "sellerGstin",
              "buyerName",
              "buyerGstin",
              "currency",
              "subtotal",
              "taxTotal",
              "total",
              "items",
              "missingFields",
              "sellerAddress",
              "buyerBillingAddress",
              "deliveryAddress",
              "contactPerson",
              "email",
              "phone",
              "poNumber",
              "paymentTerms",
              "otherTerms",
              "invoiceDueDate"
            ],
            "additionalProperties": false
          },
          "maxItems": 5
        },
        "verification": {
          "type": "object",
          "properties": {
            "status": {
              "enum": [
                "NOT_APPLICABLE",
                "INVOICE_REQUIRED",
                "DOCUMENT_UNREADABLE",
                "NO_INVOICE_DOCUMENT",
                "NOT_FOUND",
                "AMBIGUOUS",
                "MISMATCH",
                "VERIFIED",
                "REVIEW_REQUIRED"
              ]
            },
            "databaseInvoiceId": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
            },
            "databaseInvoiceNumber": {
              "type": [
                "string",
                "null"
              ],
              "maxLength": 300
            },
            "verifiedInvoiceDate": {
              "type": [
                "string",
                "null"
              ],
              "format": "date"
            },
            "matchChecks": {
              "type": "object",
              "properties": {
                "number": {
                  "type": "boolean"
                },
                "date": {
                  "type": "boolean"
                },
                "issued": {
                  "type": "boolean"
                },
                "total": {
                  "type": "boolean"
                },
                "currency": {
                  "type": "boolean"
                },
                "sellerGstin": {
                  "type": "boolean"
                },
                "buyerGstin": {
                  "type": "boolean"
                },
                "linesAvailable": {
                  "type": "boolean"
                },
                "serialNumbersVerified": {
                  "type": "boolean"
                },
                "itemLines": {
                  "type": "boolean"
                },
                "sourceComplete": {
                  "type": "boolean"
                },
                "warrantyPolicy": {
                  "type": "boolean"
                },
                "affectedProduct": {
                  "type": "boolean"
                }
              },
              "required": [],
              "additionalProperties": false
            },
            "discrepancies": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 200
              },
              "maxItems": 200
            }
          },
          "required": [
            "status",
            "databaseInvoiceId",
            "databaseInvoiceNumber",
            "verifiedInvoiceDate",
            "matchChecks",
            "discrepancies"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "attachmentStatus",
        "extracted",
        "verification"
      ],
      "additionalProperties": false
    },
    "warranty": {
      "type": "object",
      "properties": {
        "policy": {
          "enum": [
            "TWELVE_CALENDAR_MONTHS_FROM_INVOICE_DATE",
            "APPROVED_CALENDAR_MONTHS_FROM_INVOICE_DATE",
            "POLICY_UNCONFIRMED"
          ]
        },
        "months": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1,
          "maximum": 1200
        },
        "expiryDateInclusive": {
          "const": true
        },
        "timezone": {
          "const": "Asia/Kolkata"
        },
        "checkedOn": {
          "type": "string",
          "format": "date"
        },
        "invoiceDate": {
          "type": [
            "string",
            "null"
          ],
          "format": "date"
        },
        "expiresOn": {
          "type": [
            "string",
            "null"
          ],
          "format": "date"
        },
        "status": {
          "enum": [
            "NOT_APPLICABLE",
            "INVOICE_REQUIRED",
            "PENDING_VERIFICATION",
            "ELIGIBLE_FOR_ASSESSMENT",
            "EXPIRED",
            "PRODUCT_NOT_ON_INVOICE",
            "INVALID_INVOICE_DATE",
            "REVIEW_REQUIRED"
          ]
        },
        "reasonCode": {
          "type": "string",
          "maxLength": 200
        },
        "claimApproved": {
          "const": false
        },
        "appliedPolicy": {
          "type": "object",
          "properties": {
            "status": {
              "const": "RESOLVED"
            },
            "months": {
              "type": "integer",
              "minimum": 1
            },
            "source": {
              "enum": [
                "APPROVED_DATABASE_POLICY",
                "USER_CONFIGURED_DEFAULT"
              ]
            },
            "policyIds": {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
              },
              "maxItems": 200
            }
          },
          "required": [
            "status",
            "months",
            "source"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "policy",
        "months",
        "expiryDateInclusive",
        "timezone",
        "checkedOn",
        "invoiceDate",
        "expiresOn",
        "status",
        "reasonCode",
        "claimApproved"
      ],
      "additionalProperties": false
    },
    "replies": {
      "type": "object",
      "properties": {
        "acknowledgement": {
          "type": "object",
          "properties": {
            "required": {
              "type": "boolean"
            },
            "status": {
              "enum": [
                "NOT_REQUIRED",
                "PENDING",
                "PREPARED",
                "SENT",
                "FAILED",
                "UNCERTAIN"
              ]
            },
            "providerMessageId": {
              "type": [
                "string",
                "null"
              ],
              "maxLength": 200
            },
            "text": {
              "type": [
                "string",
                "null"
              ],
              "maxLength": 100000
            }
          },
          "required": [
            "required",
            "status",
            "providerMessageId",
            "text"
          ],
          "additionalProperties": false
        },
        "answer": {
          "type": "object",
          "properties": {
            "status": {
              "enum": [
                "NOT_REQUIRED",
                "PENDING",
                "PREPARED",
                "SENT",
                "FAILED",
                "UNCERTAIN"
              ]
            },
            "providerMessageId": {
              "type": [
                "string",
                "null"
              ],
              "maxLength": 200
            },
            "text": {
              "type": [
                "string",
                "null"
              ],
              "maxLength": 100000
            },
            "selectedFactIds": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 200
              },
              "maxItems": 50
            },
            "modelSelectionFailed": {
              "type": "boolean"
            }
          },
          "required": [
            "status",
            "providerMessageId",
            "text",
            "selectedFactIds",
            "modelSelectionFailed"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "acknowledgement",
        "answer"
      ],
      "additionalProperties": false
    },
    "requiresReview": {
      "type": "boolean"
    },
    "reviewReasons": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 2000
      },
      "maxItems": 500
    },
    "processedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "schemaVersion",
    "eventId",
    "requestKey",
    "revision",
    "companyId",
    "department",
    "category",
    "intent",
    "source",
    "identity",
    "request",
    "products",
    "invoice",
    "warranty",
    "replies",
    "requiresReview",
    "reviewReasons",
    "processedAt"
  ],
  "additionalProperties": false,
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MEHETA Customer Support outbound CRM JSON v1"
};
