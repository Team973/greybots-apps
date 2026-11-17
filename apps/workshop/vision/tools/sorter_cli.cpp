// Runs the part sorter over photos and draws what the Workshop page would
// show, for tuning and review.
//
//   sorter_cli [--out DIR] [--work PX] [--steps N] [--labels DIR | --maps DIR] [--debug] photo...
//
// --labels DIR takes the parts from <name>-labels.png in DIR (16-bit, one
// number per part, at the working size; tools/sam_masks.py writes them)
// instead of finding them itself. --maps DIR takes them from the part-finding
// network's <name>-fg.png and <name>-core.png (tools/seg.py predict).
//
// For each photo it writes, to DIR (default: data/out/):
//   <name>-step1.png ...  the page at each step: the current group in its
//                         color, the other parts dimmed, "?" in yellow
//   <name>-groups.png     every group in its color, with a key
//   <name>-mask.png       (--debug) what counted as a part
// and prints a JSON line per photo: parts found, "?", groups, and time.
#include "../src/sorter.h"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace sorter;

namespace {

void dashed(cv::Mat& img, const std::vector<cv::Point>& c, const cv::Scalar& color, int thickness) {
    for (size_t i = 0; i < c.size(); ++i)
        if ((i / 4) % 2 == 0) cv::line(img, c[i], c[(i + 1) % c.size()], color, thickness, cv::LINE_AA);
}

void fill(cv::Mat& img, const std::vector<cv::Point>& c, const cv::Scalar& color, double alpha) {
    cv::Rect r = cv::boundingRect(c) & cv::Rect(0, 0, img.cols, img.rows);
    if (r.empty()) return;
    cv::Mat roi = img(r), layer = roi.clone();
    cv::drawContours(layer, std::vector<std::vector<cv::Point>>{c}, 0, color, cv::FILLED, cv::LINE_AA, cv::noArray(), INT_MAX,
                     -r.tl());
    cv::addWeighted(layer, alpha, roi, 1 - alpha, 0, roi);
}

void text(cv::Mat& img, const std::string& s, cv::Point at, double scale, const cv::Scalar& color, int weight = 1) {
    cv::putText(img, s, at, cv::FONT_HERSHEY_DUPLEX, scale, color, weight, cv::LINE_AA);
}

int countUnknown(const Frame& f) {
    int n = 0;
    for (const auto& p : f.parts) n += p.group < 0;
    return n;
}

// The page during step `current` (0-based): earlier groups are already gone,
// so they're left out.
cv::Mat drawStep(const cv::Mat& work, const Frame& f, int current) {
    cv::Mat img;
    work.convertTo(img, -1, 0.55, 0);
    const cv::Scalar color = groupColor(current);
    const int t = std::max(2, work.cols / 500);
    for (const auto& p : f.parts) {
        if (p.group >= 0 && p.group < current) continue;
        if (p.group == current) {
            fill(img, p.outline, color, 0.6);
            cv::polylines(img, p.outline, true, color, t, cv::LINE_AA);
        } else if (p.group < 0) {
            dashed(img, p.outline, unknownColor(), t);
        } else {
            cv::polylines(img, p.outline, true, {150, 150, 150}, 1, cv::LINE_AA);
        }
    }
    // The header the page shows.
    const int h = std::max(80, work.cols / 9);
    cv::Mat bar(h, img.cols, img.type(), cv::Scalar(32, 32, 32));
    cv::rectangle(bar, {0, 0}, {h / 4, h}, color, cv::FILLED);
    const auto& g = f.groups[size_t(current)];
    double s = h / 60.0;
    text(bar, "Group " + std::to_string(current + 1) + " of " + std::to_string(f.groups.size()) + "  -  " +
                  std::to_string(g.count) + " left",
         {h / 2, int(h * 0.42)}, 0.6 * s, {255, 255, 255}, 2);
    int unknown = countUnknown(f);
    if (unknown)
        text(bar, std::to_string(unknown) + " ? - spread these apart", {h / 2, int(h * 0.82)}, 0.45 * s, unknownColor(), 1);
    cv::Mat out;
    cv::vconcat(bar, img, out);
    return out;
}

cv::Mat drawGroups(const cv::Mat& work, const Frame& f) {
    cv::Mat img;
    work.convertTo(img, -1, 0.55, 0);
    const int t = std::max(2, work.cols / 600);
    for (const auto& p : f.parts) {
        if (p.group < 0) {
            dashed(img, p.outline, unknownColor(), t);
        } else {
            fill(img, p.outline, groupColor(p.group), 0.6);
            cv::polylines(img, p.outline, true, groupColor(p.group), t, cv::LINE_AA);
        }
    }
    // A key: one row per group, largest first.
    const int row = std::max(30, work.rows / 32);
    const int cols = 2;
    const int rows = int((f.groups.size() + 1 + cols - 1) / cols);
    cv::Mat key(row * rows + row / 2, img.cols, img.type(), cv::Scalar(32, 32, 32));
    double s = row / 34.0;
    for (size_t g = 0; g <= f.groups.size(); ++g) {
        int c = int(g) % cols, r = int(g) / cols;
        cv::Point at(c * img.cols / cols + row / 2, r * row + row / 4);
        if (g < f.groups.size()) {
            const auto& gr = f.groups[g];
            cv::rectangle(key, at, at + cv::Point(row * 2 / 3, row * 2 / 3), groupColor(int(g)), cv::FILLED);
            char buf[128];
            std::snprintf(buf, sizeof buf, "%zu: %d parts   L %.0f px  d %.1f px", g + 1, gr.total, gr.length, gr.diameter);
            text(key, buf, at + cv::Point(row, row / 2), 0.62 * s, {235, 235, 235});
        } else {
            cv::rectangle(key, at, at + cv::Point(row * 2 / 3, row * 2 / 3), unknownColor(), 2);
            text(key, "?: " + std::to_string(countUnknown(f)) + " (clumps, standing)", at + cv::Point(row, row / 2), 0.62 * s,
                 {235, 235, 235});
        }
    }
    cv::Mat out;
    cv::vconcat(img, key, out);
    return out;
}

}  // namespace

int main(int argc, char** argv) {
    fs::path outDir = "data/out";
    Params params;
    int steps = 3;
    bool debug = false;
    fs::path labelsDir, mapsDir;
    std::vector<fs::path> photos;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--out" && i + 1 < argc) outDir = argv[++i];
        else if (a == "--work" && i + 1 < argc) params.workSize = std::atoi(argv[++i]);
        else if (a == "--steps" && i + 1 < argc) steps = std::atoi(argv[++i]);
        else if (a == "--labels" && i + 1 < argc) labelsDir = argv[++i];
        else if (a == "--maps" && i + 1 < argc) mapsDir = argv[++i];
        else if (a == "--debug") debug = true;
        else photos.emplace_back(a);
    }
    if (photos.empty()) {
        std::fprintf(stderr, "usage: sorter_cli [--out DIR] [--work PX] [--steps N] [--labels DIR | --maps DIR] [--debug] photo...\n");
        return 2;
    }
    fs::create_directories(outDir);

    for (const auto& photo : photos) {
        cv::Mat bgr = cv::imread(photo.string(), cv::IMREAD_COLOR);
        if (bgr.empty()) {
            std::fprintf(stderr, "can't read %s\n", photo.string().c_str());
            continue;
        }
        const std::string name = photo.stem().string();
        cv::Mat work = prepare(bgr, params);
        Frame f;
        if (labelsDir.empty() && mapsDir.empty()) {
            Sorter sorter(Kind::Bolts, params);
            f = sorter.scan(bgr);
        } else {
            auto t0 = std::chrono::steady_clock::now();
            cv::Mat labels;
            if (!mapsDir.empty()) {
                cv::Mat fg = cv::imread((mapsDir / (name + "-fg.png")).string(), cv::IMREAD_GRAYSCALE);
                cv::Mat core = cv::imread((mapsDir / (name + "-core.png")).string(), cv::IMREAD_GRAYSCALE);
                if (fg.size() == work.size() && core.size() == work.size()) labels = labelsFromMaps(work, fg, core);
            } else {
                labels = cv::imread((labelsDir / (name + "-labels.png")).string(), cv::IMREAD_UNCHANGED);
            }
            if (labels.size() != work.size()) {
                std::fprintf(stderr, "%s: no labels or maps at the working size\n", name.c_str());
                continue;
            }
            params.keepSingles = true;
            params.minShank = 0.25;
            Detection det = detectFromLabels(work, labels, Kind::Bolts, params);
            f.groups = groupParts(det.parts, params);
            f.parts = std::move(det.parts);
            f.size = work.size();
            f.headPx = det.headPx;
            f.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        }

        for (int s = 0; s < steps && s < int(f.groups.size()); ++s)
            cv::imwrite((outDir / (name + "-step" + std::to_string(s + 1) + ".png")).string(), drawStep(work, f, s));
        cv::imwrite((outDir / (name + "-groups.png")).string(), drawGroups(work, f));
        if (debug) {
            Detection det = detect(work, Kind::Bolts, params);
            cv::imwrite((outDir / (name + "-mask.png")).string(), det.mask);
            cv::Mat d2;
            det.diff.convertTo(d2, CV_8U, 2.0);
            cv::imwrite((outDir / (name + "-diff.png")).string(), d2);
            cv::Mat t;
            std::fprintf(stderr, "%s otsu %.1f\n", name.c_str(), cv::threshold(det.diff, t, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU));
        }

        int measured = 0;
        for (const auto& p : f.parts) measured += p.group >= 0;
        std::printf("{\"photo\":\"%s\",\"parts\":%zu,\"grouped\":%d,\"unknown\":%d,\"headPx\":%.1f,\"ms\":%.1f,\"groups\":[",
                    name.c_str(), f.parts.size(), measured, countUnknown(f), f.headPx, f.ms);
        for (size_t g = 0; g < f.groups.size(); ++g)
            std::printf("%s{\"count\":%d,\"length\":%.1f,\"diameter\":%.2f,\"head\":%.2f}", g ? "," : "", f.groups[g].total,
                        f.groups[g].length, f.groups[g].diameter, f.groups[g].headWidth);
        std::printf("]}\n");
        std::fflush(stdout);
    }
    return 0;
}
