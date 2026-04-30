import http from 'k6/http';
import { check, sleep } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

export const options = {
    vus: 5, // 5 concurrent users
    duration: '20s',
    insecureSkipTLSVerify: true, // For debugging SSL handshake issues only
    thresholds: {
        http_req_failed: ['rate<0.01'], // Fail if errors > 1%
        http_req_duration: ['p(95)<1000'], // Fail if 95% of requests > 1s
    },
};

export default function () {
    const url = __ENV.API_BASE_URL;
    if (!url) {
        throw new Error("API_BASE_URL environment variable is required for load tests");
    }
    const res = http.get(url);
    check(res, { 'status is 200': (r) => r.status === 200 });
    sleep(1);
}

export function handleSummary(data) {
    return {
        "summary.html": htmlReport(data),
    };
}