# Data Contract — 26034

## Inspection

```ts
type Inspection = {
  id: string
  createdAt: string
  productId?: string
  status: "processing" | "pass" | "fail" | "review"
  images: EvidenceImage[]
  declarations: Declaration[]
  checks: ComplianceCheck[]
  notes: string[]
}
```

## Evidence image

```ts
type EvidenceImage = {
  id: string
  uri: string
  side?: "front" | "back" | "side" | "unknown"
  width: number
  height: number
}
```

## Declaration

```ts
type Declaration = {
  field:
    | "product_name"
    | "manufacturer"
    | "net_quantity"
    | "mrp"
    | "date"
    | "consumer_care"
    | "other"
  value: string
  confidence: number
  evidenceImageId?: string
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
  }
}
```

## Compliance check

```ts
type ComplianceCheck = {
  ruleId: string
  field: string
  status: "pass" | "fail" | "review" | "not_applicable"
  evidence?: string
  explanation: string
  confidence?: number
  evidenceImageId?: string
  boundingBox?: BoundingBox
}
```

## Critical rule

Never collapse `review` into `fail`.

Uncertain extraction or measurement must remain visibly uncertain.
