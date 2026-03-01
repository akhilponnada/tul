# Tul SDK Benchmark Results

## Test Configuration

| Setting | Value |
|---------|-------|
| Model | `gemini-3-flash-preview` |
| Total Tools Registered | 15 |
| Test Queries | 3 |
| Tul maxToolsPerRequest | 3 |
| Tul compressionLevel | moderate |

## Summary

| Metric | Without SDK | With Tul SDK | Difference |
|--------|-------------|--------------|------------|
| **Total Tokens** | 7338 | 3917 | -3421 (-46.6%) |
| **Avg Tools Sent** | 15.0 | 3.0 | -12.0 |
| **Avg Tools Filtered** | 0 | 12.0 | +12.0 |

## Detailed Results

### Test 1: Weather Query
> "What's the weather like in Tokyo right now?"

| Metric | Without SDK | With Tul SDK |
|--------|-------------|--------------|
| Input Tokens | 2402 | 1228 |
| Output Tokens | 55 | 89 |
| Total Tokens | 2457 | 1317 |
| Duration | 2433ms | 2356ms |
| Tools Sent | 15 | 3 |
| Tool Called | get_weather | get_weather |

**Response (Without SDK):**
> The weather in Tokyo is currently sunny with a temperature of 22°C. The humidity is at 65%, and there is a wind speed of 10 km/h....

**Response (With Tul SDK):**
> The weather in Tokyo is currently sunny with a temperature of 22°C. The humidity is at 65%, and there's a light wind blowing at 10 km/h....

---

### Test 2: Restaurant Search
> "Find me Italian restaurants in New York"

| Metric | Without SDK | With Tul SDK |
|--------|-------------|--------------|
| Input Tokens | 2449 | 1210 |
| Output Tokens | 63 | 148 |
| Total Tokens | 2512 | 1358 |
| Duration | 2550ms | 2580ms |
| Tools Sent | 15 | 3 |
| Tool Called | search_restaurants | search_restaurants |

**Response (Without SDK):**
> OK. I found a few Italian restaurants in New York for you:
1. Bella Italia ($$, 4.5 stars)
2. Pasta Paradise ($$, 4.3 stars)...

**Response (With Tul SDK):**
> OK. I found a few Italian restaurants in New York for you:

* **Bella Italia**: A highly-rated spot (4.5 stars) with a moderate price range ($$).
* **Pasta Paradise**: Another great option with a 4.3-...

---

### Test 3: Calculation
> "Calculate 15 * 23 + 47"

| Metric | Without SDK | With Tul SDK |
|--------|-------------|--------------|
| Input Tokens | 2324 | 1192 |
| Output Tokens | 45 | 50 |
| Total Tokens | 2369 | 1242 |
| Duration | 2685ms | 2191ms |
| Tools Sent | 15 | 3 |
| Tool Called | calculate | calculate |

**Response (Without SDK):**
> The result of the calculation 15 * 23 + 47 is 392....

**Response (With Tul SDK):**
> 15 * 23 + 47 = 392...

---

## Key Benefits of Tul SDK

### 1. Smart Tool Filtering
- **Without SDK**: All 15 tools sent with every request
- **With Tul**: Only 3 relevant tools sent (12 filtered out)
- **Benefit**: Reduces input tokens and improves model accuracy

### 2. Automatic Tool Loop Handling
- **Without SDK**: Manual 2-step process (get function call → send result)
- **With Tul**: Single `chat()` call handles everything automatically
- **Benefit**: Cleaner code, less boilerplate

### 3. Additional Features (Not Benchmarked)
- Schema compression (saves tokens on tool definitions)
- Result caching (skip redundant API calls)
- JSON repair (fix malformed responses)
- Loop detection (prevent runaway tool calls)
- Strict validation (catch schema errors)

## Conclusion

Tul SDK saved **3421 tokens (46.6%)** across 3 test queries while maintaining identical functionality.

The main value of Tul comes from:
1. **Developer Experience**: One-line tool calling instead of manual loop management
2. **Reliability**: Built-in JSON repair, retry logic, and validation
3. **Scalability**: With larger toolsets (50+ tools), filtering saves significant tokens

---

*Generated: 2026-03-01T12:18:41.326Z*
