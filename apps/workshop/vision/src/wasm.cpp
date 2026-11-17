// The WebAssembly module's interface, for the Workshop page's worker
// (apps/workshop/src/lib/partSorter/worker.ts). Plain C functions: the worker
// copies the photo and the network's two maps into the module's memory
// (malloc), calls sorter_run, and reads back a JSON string.
#include "sorter.h"

#include <opencv2/imgproc.hpp>

#include <emscripten/emscripten.h>

#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>

using namespace sorter;

namespace {

std::unique_ptr<Sorter> current;
std::string result;

void append(std::string& s, const char* fmt, double a) {
    char buf[64];
    std::snprintf(buf, sizeof buf, fmt, a);
    s += buf;
}

std::string toJson(const Frame& f) {
    std::string s;
    s.reserve(64 * 1024);
    s += "{\"width\":" + std::to_string(f.size.width) + ",\"height\":" + std::to_string(f.size.height);
    append(s, ",\"scale\":%.4f", f.scale);
    append(s, ",\"headPx\":%.2f", f.headPx);
    append(s, ",\"ms\":%.1f", f.ms);
    s += ",\"groups\":[";
    for (size_t g = 0; g < f.groups.size(); ++g) {
        const Group& gr = f.groups[g];
        if (g) s += ',';
        append(s, "{\"length\":%.1f", gr.length);
        append(s, ",\"diameter\":%.2f", gr.diameter);
        s += ",\"count\":" + std::to_string(gr.count) + ",\"total\":" + std::to_string(gr.total) + "}";
    }
    s += "],\"parts\":[";
    for (size_t i = 0; i < f.parts.size(); ++i) {
        const Part& p = f.parts[i];
        if (i) s += ',';
        s += "{\"group\":" + std::to_string(p.group) + ",\"outline\":[";
        // Simplified to about a pixel: plenty for drawing, a tenth the size.
        std::vector<cv::Point> o;
        cv::approxPolyDP(p.outline, o, 1.0, true);
        for (size_t k = 0; k < o.size(); ++k) {
            if (k) s += ',';
            s += std::to_string(o[k].x) + ',' + std::to_string(o[k].y);
        }
        s += "]}";
    }
    s += "]}";
    return s;
}

}  // namespace

extern "C" {

// Starts a new sort: 0 = bolts, 1 = gears. Forgets any locked groups.
EMSCRIPTEN_KEEPALIVE void sorter_init(int kind) {
    Params params;
    // Parts come from the network, so a lone part is a real one, and small
    // bolts in a pile of big ones aren't slivers (see Params).
    params.keepSingles = true;
    params.minShank = 0.25;
    current = std::make_unique<Sorter>(kind == 1 ? Kind::Gears : Kind::Bolts, params);
}

// Finds the parts in one photo. `rgba` is the photo at the working size
// (width x height x 4); `fg` and `core` are the network's maps at the same
// size (0-255). mode 0 = scan (find and lock the groups), 1 = check (match to
// the locked groups). Returns JSON, valid until the next call.
EMSCRIPTEN_KEEPALIVE const char* sorter_run(int mode, const uint8_t* rgba, int width, int height, const uint8_t* fg,
                                            const uint8_t* core) {
    if (!current) sorter_init(0);
    cv::Mat photo(height, width, CV_8UC4, const_cast<uint8_t*>(rgba));
    cv::Mat work;
    cv::cvtColor(photo, work, cv::COLOR_RGBA2BGR);
    cv::Mat f(height, width, CV_8U, const_cast<uint8_t*>(fg));
    cv::Mat c(height, width, CV_8U, const_cast<uint8_t*>(core));
    Frame frame = mode == 0 ? current->scanMaps(work, f, c) : current->checkMaps(work, f, c);
    result = toJson(frame);
    return result.c_str();
}

}  // extern "C"
