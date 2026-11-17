// The part sorter's vision pipeline: find the parts in a frame, measure them,
// and group them by type. See apps/workshop/docs/part-sorter-design.md.
//
// The same code builds natively (tools/sorter_cli, for tuning on sample
// photos) and to WebAssembly (src/wasm.cpp, for the Workshop page).
#pragma once

#include <opencv2/core.hpp>

#include <chrono>
#include <vector>

namespace sorter {

enum class Kind { Bolts = 0, Gears = 1 };

struct Params {
    // Frames are shrunk to this many pixels on their long side first. A scan
    // wants detail (shank widths); live tracking wants speed.
    int workSize = 1280;
    // The least a part can differ from the background (Lab lightness, 0-255),
    // whatever Otsu's threshold says.
    double minDiff = 28;
    // How far apart two types are, on log(length) and log(shank diameter):
    // the mean-shift bandwidths used to group parts.
    double lengthBandwidth = 0.07;
    double diameterBandwidth = 0.09;
    // Checks: a part further than this (in bandwidths) from every part seen
    // at the scan is "?".
    double unknownDistance = 2.5;
    // Keep a type with a single part. Off for the classical finder, whose
    // lone parts are mostly bad splits; on for a mask finder such as SAM.
    bool keepSingles = false;
    // The thinnest shank a bolt can have, as a share of a typical part's
    // width. Thinner is taken for a sliver from a bad split, which the
    // classical finder makes and a mask finder doesn't; small bolts in a pile
    // of big ones need it lower.
    double minShank = 0.4;
};

struct Part {
    std::vector<cv::Point> outline;  // In the working image's pixels.
    cv::Point2f center;
    float angle = 0;      // The part's main axis, in radians.
    float length = 0;     // Bolts: overall length, head included (px).
    float diameter = 0;   // Bolts: shank diameter (px).
    float headWidth = 0;  // Bolts: head diameter (px).
    int group = -1;       // Index into the groups, or -1 when it's "?".
    // Couldn't be measured: a clump that couldn't be split, or a part
    // standing on end. Shown as "?" (spread these apart).
    bool unknown = false;
};

struct Group {
    float length = 0, diameter = 0, headWidth = 0;  // Medians, at scan scale.
    int count = 0;  // In view in this frame.
    int total = 0;  // At the scan.
};

struct Frame {
    std::vector<Part> parts;
    std::vector<Group> groups;  // Largest first.
    cv::Size size;              // The working image's size.
    double scale = 1;           // How much bigger things look than at the scan.
    double headPx = 0;          // A typical part's width (px).
    double ms = 0;              // Time taken.
};

struct Detection;

class Sorter {
public:
    explicit Sorter(Kind kind = Kind::Bolts, Params params = {});

    // Finds and groups the parts in a still frame (BGR), and keeps the groups.
    Frame scan(const cv::Mat& bgr);
    // A later frame: each part is put in the nearest kept group, allowing for
    // the camera having moved closer or further.
    Frame process(const cv::Mat& bgr);

    // The same two, with the parts from the part-finding network's maps (see
    // labelsFromMaps). `work` is the photo (BGR) already at the working size.
    Frame scanMaps(const cv::Mat& work, const cv::Mat& fg, const cv::Mat& core);
    Frame checkMaps(const cv::Mat& work, const cv::Mat& fg, const cv::Mat& core);

    const std::vector<Group>& groups() const { return groups_; }
    Params& params() { return params_; }

private:
    Frame lock(Detection det, cv::Size size, std::chrono::steady_clock::time_point t0);
    Frame match(Detection det, cv::Size size, std::chrono::steady_clock::time_point t0);

    Kind kind_;
    Params params_;
    std::vector<Group> groups_;
    // The parts grouped at the scan (log sizes), to match later photos to.
    struct Seen {
        double logLength, logDiameter;
        int group;
    };
    std::vector<Seen> seen_;
};

// The steps, for the command-line tool and tests.
cv::Mat prepare(const cv::Mat& bgr, const Params& params);  // Shrinks to workSize.
struct Detection {
    cv::Mat diff;  // How much darker than the background each pixel is.
    cv::Mat mask;  // What counts as a part.
    std::vector<Part> parts;
    double headPx = 0;
};
Detection detect(const cv::Mat& work, Kind kind, const Params& params);
// The same, with the parts already found by something else (a mask finder
// such as SAM): `labels` gives each part's pixels a number (0 = none), at the
// working image's size.
Detection detectFromLabels(const cv::Mat& work, const cv::Mat& labels, Kind kind, const Params& params);
// The same, from the part-finding network's two maps (8-bit, 0-255, at the
// working size; tools/seg.py): `fg` says part or not, `core` marks each
// part's middle. Each core grows out to the edge of fg, which splits
// touching parts.
cv::Mat labelsFromMaps(const cv::Mat& work, const cv::Mat& fg, const cv::Mat& core);
// Groups measured parts by type, largest first, and sets each part's group.
std::vector<Group> groupParts(std::vector<Part>& parts, const Params& params);

// Group colors (BGR), color-blind safe, and the color for "?".
cv::Scalar groupColor(int index);
cv::Scalar unknownColor();

}  // namespace sorter
