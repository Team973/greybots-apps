#include "sorter.h"

#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <chrono>
#include <climits>
#include <cmath>
#include <numeric>

namespace sorter {
namespace {

double percentile(std::vector<double> v, double q) {
    if (v.empty()) return 0;
    size_t n = std::min(v.size() - 1, size_t(q * double(v.size())));
    std::nth_element(v.begin(), v.begin() + long(n), v.end());
    return v[n];
}

using Contour = std::vector<cv::Point>;

std::vector<Contour> outerContours(const cv::Mat& mask) {
    std::vector<Contour> contours;
    cv::findContours(mask.clone(), contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_NONE);
    return contours;
}

// ---------------------------------------------------------------- Finding

// How much darker than the background each pixel is (0 where it's lighter).
// The background is the surface with everything dark and smaller than the
// kernel closed over, so a slow change in lighting or a darker patch of bench
// doesn't count as a part.
cv::Mat darkness(const cv::Mat& work) {
    cv::Mat lab;
    cv::cvtColor(work, lab, cv::COLOR_BGR2Lab);
    cv::Mat L;
    cv::extractChannel(lab, L, 0);

    const double f = 0.25;
    cv::Mat small;
    cv::resize(L, small, cv::Size(), f, f, cv::INTER_AREA);
    int k = std::max(9, int(std::lround(std::max(small.cols, small.rows) * 0.08)) | 1);
    cv::Mat bg;
    cv::morphologyEx(small, bg, cv::MORPH_CLOSE, cv::getStructuringElement(cv::MORPH_ELLIPSE, {k, k}));
    cv::GaussianBlur(bg, bg, {0, 0}, k * 0.35);
    cv::resize(bg, bg, L.size(), 0, 0, cv::INTER_LINEAR);

    cv::Mat diff;
    cv::subtract(bg, L, diff);  // Saturates at 0.
    return diff;
}

cv::Mat partMask(const cv::Mat& diff, double minDiff) {
    cv::Mat mask;
    double otsu = cv::threshold(diff, mask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    if (otsu < minDiff) cv::threshold(diff, mask, minDiff, 255, cv::THRESH_BINARY);
    auto k3 = cv::getStructuringElement(cv::MORPH_ELLIPSE, {3, 3});
    cv::morphologyEx(mask, mask, cv::MORPH_OPEN, k3);
    cv::morphologyEx(mask, mask, cv::MORPH_CLOSE, cv::getStructuringElement(cv::MORPH_ELLIPSE, {5, 5}));

    // Glints on black parts read as background: fill small holes.
    const double maxHole = mask.cols * mask.rows * 1.5e-4;
    std::vector<Contour> contours;
    std::vector<cv::Vec4i> tree;
    cv::findContours(mask.clone(), contours, tree, cv::RETR_CCOMP, cv::CHAIN_APPROX_SIMPLE);
    for (size_t i = 0; i < contours.size(); ++i)
        if (tree[i][3] >= 0 && cv::contourArea(contours[i]) < maxHole)
            cv::drawContours(mask, contours, int(i), 255, cv::FILLED);
    return mask;
}

bool touchesEdge(const cv::Rect& r, cv::Size size) {
    return r.x <= 1 || r.y <= 1 || r.br().x >= size.width - 1 || r.br().y >= size.height - 1;
}

// ---------------------------------------------------------------- Splitting

// A piece of the mask, cropped to its bounding box.
struct Piece {
    cv::Mat mask;
    cv::Point offset;
    bool unknown = false;
};

// Each outer contour of `mask` as its own piece, dropping specks.
void piecesOf(const cv::Mat& mask, cv::Point offset, double minArea, std::vector<Piece>& out) {
    for (const auto& c : outerContours(mask)) {
        if (cv::contourArea(c) < minArea) continue;
        cv::Rect r = cv::boundingRect(c);
        cv::Mat m = cv::Mat::zeros(r.size(), CV_8U);
        cv::drawContours(m, std::vector<Contour>{c}, 0, 255, cv::FILLED, cv::LINE_8, cv::noArray(), INT_MAX, -r.tl());
        cv::bitwise_and(m, mask(r), m);  // Keep holes and cuts.
        out.push_back({m, offset + r.tl()});
    }
}

struct Defect {
    cv::Point at;       // The deepest point of the notch.
    cv::Point2f inward; // Direction into the part.
    double depth;
};

std::vector<Defect> defectsOf(const Contour& raw, double minDepth) {
    std::vector<Defect> out;
    // Pixel-level outlines are jagged and often touch themselves, which
    // convexityDefects rejects; a lightly simplified one doesn't.
    Contour c;
    cv::approxPolyDP(raw, c, 1.0, true);
    if (c.size() < 5) return out;
    std::vector<int> hull;
    cv::convexHull(c, hull, false, false);
    if (hull.size() < 3) return out;
    std::vector<cv::Vec4i> defects;
    try {
        cv::convexityDefects(c, hull, defects);
    } catch (const cv::Exception&) {
        return out;  // A self-touching outline; treat it as having none.
    }
    for (const auto& d : defects) {
        double depth = d[3] / 256.0;
        if (depth < minDepth) continue;
        cv::Point a = c[size_t(d[0])], b = c[size_t(d[1])], f = c[size_t(d[2])];
        cv::Point2f mid = (cv::Point2f(a) + cv::Point2f(b)) * 0.5f;
        cv::Point2f dir = cv::Point2f(f) - mid;
        float n = std::hypot(dir.x, dir.y);
        out.push_back({f, n > 0 ? dir / n : cv::Point2f(0, 0), depth});
    }
    return out;
}

double maxDefectDepth(const Contour& c) {
    double m = 0;
    for (const auto& d : defectsOf(c, 0)) m = std::max(m, d.depth);
    return m;
}

// One part: no wider than a part plus a bit, and no deep notches (where two
// parts meet). A bolt's step from head to shank is shallow.
bool looksSingle(const Contour& c, double head) {
    cv::RotatedRect rr = cv::minAreaRect(c);
    double w = std::min(rr.size.width, rr.size.height);
    return w <= 1.4 * head && maxDefectDepth(c) <= 0.28 * head;
}

struct Cut {
    cv::Point a, b;
    double score;  // Lower is better.
};

// Fraction of the segment a-b that's inside the mask.
double insideFraction(const cv::Mat& mask, cv::Point a, cv::Point b) {
    cv::LineIterator it(mask, a, b, 8);
    int in = 0;
    for (int i = 0; i < it.count; ++i, ++it)
        if (**it) ++in;
    return it.count ? double(in) / it.count : 0;
}

// Ways to cut a clump apart: between two deep notches (where two parts meet
// side by side), or straight in from one (where a part's end meets another).
std::vector<Cut> candidateCuts(const Contour& c, const cv::Mat& mask, double head) {
    auto defects = defectsOf(c, 0.2 * head);
    std::vector<Cut> cuts;
    for (size_t i = 0; i < defects.size(); ++i) {
        for (size_t j = i + 1; j < defects.size(); ++j) {
            cv::Point2f d = cv::Point2f(defects[j].at - defects[i].at);
            double len = std::hypot(d.x, d.y);
            if (len > 1.3 * head || len < 1) continue;
            // The notches should face each other.
            cv::Point2f u = d / float(len);
            if (defects[i].inward.dot(u) < 0.2 || defects[j].inward.dot(-u) < 0.2) continue;
            if (insideFraction(mask, defects[i].at, defects[j].at) < 0.8) continue;
            cuts.push_back({defects[i].at, defects[j].at, len / (defects[i].depth + defects[j].depth)});
        }
        // Straight in, until it leaves the part.
        const auto& d = defects[i];
        cv::Point2f p(d.at);
        double len = 0;
        const double maxLen = 1.4 * head;
        while (len < maxLen) {
            p += d.inward;
            len += 1;
            cv::Point q(cvRound(p.x), cvRound(p.y));
            if (q.x < 0 || q.y < 0 || q.x >= mask.cols || q.y >= mask.rows || !mask.at<uchar>(q)) break;
        }
        if (len < maxLen) {
            cv::Point end(cvRound(p.x + d.inward.x), cvRound(p.y + d.inward.y));
            cuts.push_back({d.at, end, 1.6 * len / d.depth});
        }
    }
    std::sort(cuts.begin(), cuts.end(), [](const Cut& x, const Cut& y) { return x.score < y.score; });
    return cuts;
}

// Zhang-Suen thinning: the mask's one-pixel-wide center lines.
cv::Mat skeleton(const cv::Mat& mask) {
    cv::Mat img;
    cv::copyMakeBorder(mask, img, 1, 1, 1, 1, cv::BORDER_CONSTANT, 0);
    img /= 255;
    cv::Mat marker = cv::Mat::zeros(img.size(), CV_8U);
    bool changed = true;
    while (changed) {
        changed = false;
        for (int pass = 0; pass < 2; ++pass) {
            marker.setTo(0);
            for (int y = 1; y < img.rows - 1; ++y) {
                const uchar* up = img.ptr<uchar>(y - 1);
                const uchar* row = img.ptr<uchar>(y);
                const uchar* dn = img.ptr<uchar>(y + 1);
                for (int x = 1; x < img.cols - 1; ++x) {
                    if (!row[x]) continue;
                    int p2 = up[x], p3 = up[x + 1], p4 = row[x + 1], p5 = dn[x + 1];
                    int p6 = dn[x], p7 = dn[x - 1], p8 = row[x - 1], p9 = up[x - 1];
                    int B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                    if (B < 2 || B > 6) continue;
                    int A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) +
                            (!p8 && p9) + (!p9 && p2);
                    if (A != 1) continue;
                    if (pass == 0 ? ((p2 && p4 && p6) || (p4 && p6 && p8)) : ((p2 && p4 && p8) || (p2 && p6 && p8))) continue;
                    marker.at<uchar>(y, x) = 1;
                }
            }
            if (cv::countNonZero(marker)) {
                changed = true;
                img.setTo(0, marker);
            }
        }
    }
    return img(cv::Rect(1, 1, mask.cols, mask.rows)) * 255;
}

struct Axis {
    cv::Point2f a, b;  // Ends.
    float length() const { return std::hypot(b.x - a.x, b.y - a.y); }
};

// Distance from p to the segment a-b.
float segmentDistance(cv::Point2f p, const Axis& s) {
    cv::Point2f d = s.b - s.a;
    float l2 = d.dot(d);
    float t = l2 > 0 ? std::clamp((p - s.a).dot(d) / l2, 0.0f, 1.0f) : 0.0f;
    cv::Point2f q = s.a + t * d - p;
    return std::hypot(q.x, q.y);
}

bool maskAt(const cv::Mat& mask, cv::Point2f p) {
    int x = cvRound(p.x), y = cvRound(p.y);
    return x >= 0 && y >= 0 && x < mask.cols && y < mask.rows && mask.at<uchar>(y, x);
}

// A clump that couldn't be cut apart at its notches: crossed and piled bolts.
// Each bolt is a straight, thick bar, so its center line is a straight run of
// the clump's skeleton. Find those runs (longest first), stretch each to the
// clump's edge, and give every pixel to the nearest one.
void splitByAxes(const Piece& piece, double head, std::vector<Piece>& out) {
    cv::Mat skel = skeleton(piece.mask);
    std::vector<cv::Vec4i> lines;
    cv::HoughLinesP(skel, lines, 1, CV_PI / 90, std::max(5, int(0.35 * head)), 0.55 * head, 0.3 * head);

    std::vector<Axis> found;
    for (const auto& l : lines) found.push_back({cv::Point2f(float(l[0]), float(l[1])), cv::Point2f(float(l[2]), float(l[3]))});
    std::sort(found.begin(), found.end(), [](const Axis& x, const Axis& y) { return x.length() > y.length(); });

    std::vector<Axis> axes;
    for (auto ax : found) {
        // Skip a run that's mostly along one already taken.
        int n = std::max(2, int(ax.length()));
        int near = 0;
        for (int i = 0; i <= n; ++i) {
            cv::Point2f p = ax.a + (ax.b - ax.a) * (float(i) / float(n));
            for (const auto& t : axes)
                if (segmentDistance(p, t) < 0.45 * head) {
                    ++near;
                    break;
                }
        }
        if (near > 0.4 * (n + 1)) continue;
        // Stretch to the clump's edge both ways (a skeleton stops short of
        // a bar's ends by half its width).
        cv::Point2f u = ax.b - ax.a;
        u /= std::max(1.0f, ax.length());
        for (int end = 0; end < 2; ++end) {
            cv::Point2f& p = end ? ax.b : ax.a;
            cv::Point2f dir = end ? u : -u;
            int misses = 0;
            // No further than a bit more than half a head: further would run
            // on into a bolt lying end to end with this one.
            for (int step = 0; step < 0.8 * head && misses < 2; ++step) {
                cv::Point2f q = p + dir;
                if (maskAt(piece.mask, q)) {
                    p = q;
                    misses = 0;
                } else {
                    ++misses;
                    p = q;
                }
            }
            p -= dir * float(misses);
        }
        axes.push_back(ax);
    }
    if (axes.empty()) {
        Piece p = piece;
        p.unknown = true;
        out.push_back(p);
        return;
    }

    // Each pixel goes to the nearest axis within reach of a head's width.
    std::vector<cv::Mat> masks(axes.size());
    for (auto& m : masks) m = cv::Mat::zeros(piece.mask.size(), CV_8U);
    cv::Mat leftover = cv::Mat::zeros(piece.mask.size(), CV_8U);
    const float reach = float(0.7 * head);
    for (int y = 0; y < piece.mask.rows; ++y)
        for (int x = 0; x < piece.mask.cols; ++x) {
            if (!piece.mask.at<uchar>(y, x)) continue;
            const cv::Point2f p{float(x), float(y)};
            int best = -1;
            float bd = reach;
            for (size_t i = 0; i < axes.size(); ++i) {
                float d = segmentDistance(p, axes[i]);
                if (d < bd) {
                    bd = d;
                    best = int(i);
                }
            }
            if (best >= 0)
                masks[size_t(best)].at<uchar>(y, x) = 255;
            else
                leftover.at<uchar>(y, x) = 255;
        }
    for (auto& m : masks) {
        // Keep the biggest connected part (the bolt), not stray corners.
        std::vector<Piece> parts;
        piecesOf(m, piece.offset, 0.3 * head * head, parts);
        if (parts.empty()) continue;
        auto big = std::max_element(parts.begin(), parts.end(), [](const Piece& x, const Piece& y) {
            return cv::countNonZero(x.mask) < cv::countNonZero(y.mask);
        });
        out.push_back(*big);
    }
    std::vector<Piece> rest;
    piecesOf(leftover, piece.offset, 0.8 * head * head, rest);
    for (auto& r : rest) {
        r.unknown = true;
        out.push_back(r);
    }
}

void split(Piece piece, double head, int budget, std::vector<Piece>& out) {
    auto contours = outerContours(piece.mask);
    if (contours.empty()) return;
    const Contour& c = *std::max_element(contours.begin(), contours.end(),
                                         [](const Contour& x, const Contour& y) { return x.size() < y.size(); });
    if (looksSingle(c, head)) {
        out.push_back(piece);
        return;
    }
    if (budget > 0) {
        auto cuts = candidateCuts(c, piece.mask, head);
        for (size_t i = 0; i < cuts.size() && i < 10; ++i) {
            cv::Mat m = piece.mask.clone();
            // A little past both ends, so no corner pixel joins the halves.
            cv::Point2f a(cuts[i].a), b(cuts[i].b), u = b - a;
            float n = std::max(1.0f, std::hypot(u.x, u.y));
            u *= 3.0f / n;
            cv::line(m, a - u, b + u, 0, 3);
            std::vector<Piece> parts;
            piecesOf(m, piece.offset, 0.3 * head * head, parts);
            if (parts.size() >= 2) {
                for (auto& p : parts) split(p, head, budget - 1, out);
                return;
            }
        }
    }
    splitByAxes(piece, head, out);
}

// ---------------------------------------------------------------- Measuring

// Lays the piece along x and measures its width at each step along it. The
// width is "soft": each pixel counts by how dark it is relative to the part's
// core, so edges count partly and widths come out finer than a pixel.
void measureBolt(const Piece& piece, const cv::Mat& diff, double head, double minShank, Part& part) {
    cv::Moments m = cv::moments(piece.mask, true);
    if (m.m00 <= 0) {
        part.unknown = true;
        return;
    }
    cv::Point2f c(float(m.m10 / m.m00), float(m.m01 / m.m00));
    double theta = 0.5 * std::atan2(2 * m.mu11, m.mu20 - m.mu02);
    part.center = c + cv::Point2f(piece.offset);
    part.angle = float(theta);

    // The piece's own pixels (and a pixel around them, for soft edges).
    cv::Rect r(piece.offset, piece.mask.size());
    cv::Mat grown;
    cv::dilate(piece.mask, grown, cv::getStructuringElement(cv::MORPH_RECT, {3, 3}));
    cv::Mat d;
    diff(r).convertTo(d, CV_32F);
    std::vector<double> inside;
    for (int y = 0; y < d.rows; ++y)
        for (int x = 0; x < d.cols; ++x)
            if (piece.mask.at<uchar>(y, x)) inside.push_back(d.at<float>(y, x));
    double core = std::max(1.0, percentile(inside, 0.6));
    cv::Mat weight = d / core;
    cv::min(weight, 1.0, weight);
    cv::Mat zero = grown == 0;
    weight.setTo(0, zero);

    int D = int(std::ceil(std::hypot(r.width, r.height))) + 6;
    cv::Mat rot = cv::getRotationMatrix2D(c, theta * 180.0 / CV_PI, 1.0);
    rot.at<double>(0, 2) += D / 2.0 - c.x;
    rot.at<double>(1, 2) += D / 2.0 - c.y;
    cv::Mat hard, soft;
    cv::warpAffine(piece.mask, hard, rot, {D, D}, cv::INTER_NEAREST);
    cv::warpAffine(weight, soft, rot, {D, D}, cv::INTER_LINEAR);
    // Make sure the long axis is across, whichever way the angle went.
    cv::Mat colsAny, rowsAny;
    cv::reduce(hard, colsAny, 0, cv::REDUCE_MAX);
    cv::reduce(hard, rowsAny, 1, cv::REDUCE_MAX);
    if (cv::countNonZero(rowsAny) > cv::countNonZero(colsAny)) {
        cv::transpose(hard, hard);
        cv::transpose(soft, soft);
        part.angle += float(CV_PI / 2);
    }

    cv::Mat hardCount, softSum;
    cv::Mat hard01;
    hard.convertTo(hard01, CV_32F, 1.0 / 255);
    cv::reduce(hard01, hardCount, 0, cv::REDUCE_SUM, CV_32F);
    cv::reduce(soft, softSum, 0, cv::REDUCE_SUM, CV_32F);
    int x0 = -1, x1 = -1;
    for (int x = 0; x < D; ++x)
        if (hardCount.at<float>(x) > 0.5f) {
            if (x0 < 0) x0 = x;
            x1 = x;
        }
    if (x0 < 0) {
        part.unknown = true;
        return;
    }
    std::vector<double> widths;
    for (int x = x0; x <= x1; ++x) widths.push_back(softSum.at<float>(x));
    int len = int(widths.size());
    part.length = float(len);

    // A bolt seen end-on (or a nut-sized blob) can't be measured.
    if (len < 1.25 * head) {
        part.unknown = true;
        return;
    }

    // The head is the wider end.
    int q = std::max(3, len / 5);
    double a = std::accumulate(widths.begin(), widths.begin() + q, 0.0);
    double b = std::accumulate(widths.end() - q, widths.end(), 0.0);
    if (b > a) std::reverse(widths.begin(), widths.end());

    int headLen = std::max(2, int(std::lround(std::min(0.4 * len, 0.9 * head))));
    std::vector<double> headWidths(widths.begin(), widths.begin() + headLen);
    part.headWidth = float(percentile(headWidths, 0.75));

    // A socket head is about as long as the shank is wide (2/3 of its own
    // width); the shank starts after that, and stops short of the tip.
    int s0 = int(std::lround(part.headWidth * 0.85)) + 2, s1 = len - 2;
    if (s1 - s0 < 3) {
        s0 = int(len * 0.6);
        s1 = len - 1;
    }
    std::vector<double> shank(widths.begin() + s0, widths.begin() + std::max(s0 + 1, s1));
    part.diameter = float(percentile(shank, 0.5));

    // Two shanks lying side by side look like one wide bolt with no head; a
    // sliver left over from splitting a clump is too thin; a piece of two
    // crossed bolts has a "head" much wider than anyone's.
    if (part.diameter > 0.86 * part.headWidth || part.diameter < minShank * head || part.headWidth < 0.6 * head ||
        part.headWidth > 1.45 * head)
        part.unknown = true;
}

std::vector<Part> measurePieces(const std::vector<Piece>& pieces, const cv::Mat& diff, double head, Kind kind, double minShank) {
    std::vector<Part> parts;
    for (const auto& p : pieces) {
        Part part;
        auto contours = outerContours(p.mask);
        if (contours.empty()) continue;
        Contour c = *std::max_element(contours.begin(), contours.end(),
                                      [](const Contour& x, const Contour& y) { return x.size() < y.size(); });
        for (auto& pt : c) pt += p.offset;
        part.outline = std::move(c);
        if (kind == Kind::Bolts && !p.unknown) {
            measureBolt(p, diff, head, minShank, part);
        } else {
            cv::Moments m = cv::moments(p.mask, true);
            part.center = cv::Point2f(float(m.m10 / std::max(1.0, m.m00)), float(m.m01 / std::max(1.0, m.m00))) +
                          cv::Point2f(p.offset);
            part.unknown = true;
        }
        parts.push_back(std::move(part));
    }
    return parts;
}

}  // namespace

// ---------------------------------------------------------------- Public

cv::Mat prepare(const cv::Mat& bgr, const Params& params) {
    double s = double(params.workSize) / std::max(bgr.cols, bgr.rows);
    cv::Mat out;
    if (s < 1)
        cv::resize(bgr, out, cv::Size(), s, s, cv::INTER_AREA);
    else
        out = bgr.clone();
    return out;
}

Detection detect(const cv::Mat& work, Kind kind, const Params& params) {
    Detection det;
    det.diff = darkness(work);
    det.mask = partMask(det.diff, params.minDiff);

    // A typical part's width: twice the deepest point inside each blob
    // (the middle of a bolt's head), median over all blobs.
    std::vector<Piece> blobs, found;
    double minArea = std::max(20.0, work.cols * work.rows * 4e-5);
    piecesOf(det.mask, {0, 0}, minArea, found);
    // Anything cut off by the frame's edge can't be measured, and is usually
    // something else (a hand, a bin, a cable): left out.
    for (auto& b : found)
        if (!touchesEdge(cv::Rect(b.offset, b.mask.size()), work.size())) blobs.push_back(std::move(b));

    std::vector<double> widths(blobs.size());
    std::vector<double> areas;
    for (size_t i = 0; i < blobs.size(); ++i) {
        cv::Mat dt;
        cv::distanceTransform(blobs[i].mask, dt, cv::DIST_L2, 3);
        double mx;
        cv::minMaxLoc(dt, nullptr, &mx);
        widths[i] = 2 * mx;
        areas.push_back(cv::countNonZero(blobs[i].mask));
    }
    // Bolts lying on their own are bars: long, and filling most of their
    // hull. Their width (at the head) is the scale for everything else.
    // Without enough of those, the thinner half of the bigger blobs.
    std::vector<double> loners;
    for (size_t i = 0; i < blobs.size(); ++i) {
        auto cs = outerContours(blobs[i].mask);
        if (cs.empty()) continue;
        const Contour& c = *std::max_element(cs.begin(), cs.end(), [](const Contour& x, const Contour& y) { return x.size() < y.size(); });
        cv::RotatedRect rr = cv::minAreaRect(c);
        double w = std::min(rr.size.width, rr.size.height), h = std::max(rr.size.width, rr.size.height);
        std::vector<cv::Point> hull;
        cv::convexHull(c, hull);
        double solidity = areas[i] / std::max(1.0, cv::contourArea(hull));
        if (w > 3 && h >= 1.5 * w && h <= 8 * w && solidity >= 0.8) loners.push_back(w);
    }
    if (loners.size() >= 5) {
        det.headPx = percentile(loners, 0.5);
    } else {
        double bigArea = percentile(areas, 0.3);
        std::vector<double> big;
        for (size_t i = 0; i < blobs.size(); ++i)
            if (areas[i] >= bigArea) big.push_back(widths[i]);
        det.headPx = std::max(4.0, percentile(big, 0.35));
    }
    const double head = det.headPx;

    std::vector<Piece> pieces;
    for (size_t i = 0; i < blobs.size(); ++i) {
        if (widths[i] < 0.45 * head) continue;  // A scratch or a crack.
        split(blobs[i], head, 12, pieces);
    }

    det.parts = measurePieces(pieces, det.diff, head, kind, params.minShank);
    return det;
}

Detection detectFromLabels(const cv::Mat& work, const cv::Mat& labels, Kind kind, const Params& params) {
    Detection det;
    det.diff = darkness(work);
    det.mask = cv::Mat::zeros(work.size(), CV_8U);
    cv::Mat lab;
    labels.convertTo(lab, CV_32S);
    double maxId;
    cv::minMaxLoc(lab, nullptr, &maxId);

    // One piece per label: each label's pixels, cropped. A mask finder also
    // returns bits of bench (scratches, stains), which aren't dark enough to
    // be a black part, and anything cut off by the frame.
    std::vector<Piece> pieces;
    std::vector<double> shortSides, widths;
    for (int id = 1; id <= int(maxId); ++id) {
        cv::Mat m = lab == id;
        cv::Rect r = cv::boundingRect(m);
        if (r.area() == 0 || touchesEdge(r, work.size())) continue;
        Piece p{m(r).clone(), r.tl()};
        double darkness = cv::mean(det.diff(r), p.mask)[0];
        if (darkness < params.minDiff) continue;
        auto cs = outerContours(p.mask);
        if (cs.empty()) continue;
        const Contour& c = *std::max_element(cs.begin(), cs.end(), [](const Contour& x, const Contour& y) { return x.size() < y.size(); });
        cv::RotatedRect rr = cv::minAreaRect(c);
        double w = std::min(rr.size.width, rr.size.height), h = std::max(rr.size.width, rr.size.height);
        if (w > 3 && h >= 1.5 * w && h <= 8 * w) shortSides.push_back(w);
        pieces.push_back(std::move(p));
        widths.push_back(w);
    }
    det.headPx = std::max(4.0, percentile(shortSides, 0.5));
    // Scratches are thinner than any shank, and specks smaller than a head.
    std::vector<Piece> kept;
    for (size_t i = 0; i < pieces.size(); ++i) {
        if (widths[i] < 0.4 * det.headPx || cv::countNonZero(pieces[i].mask) < 0.5 * det.headPx * det.headPx) continue;
        det.mask(cv::Rect(pieces[i].offset, pieces[i].mask.size())).setTo(255, pieces[i].mask);
        kept.push_back(std::move(pieces[i]));
    }
    pieces = std::move(kept);
    det.parts = measurePieces(pieces, det.diff, det.headPx, kind, params.minShank);
    return det;
}

cv::Mat labelsFromMaps(const cv::Mat& work, const cv::Mat& fg, const cv::Mat& core) {
    cv::Mat part = fg > 127;
    cv::Mat seeds = (core > 127) & part;
    cv::morphologyEx(seeds, seeds, cv::MORPH_OPEN, cv::getStructuringElement(cv::MORPH_RECT, {2, 2}));
    cv::Mat markers;
    int n = cv::connectedComponents(seeds, markers, 8, CV_32S);
    // Watershed from the cores (2..n) and the bench (1), over the photo:
    // where two parts touch, the line between them follows the edges.
    markers += 1;
    markers.setTo(0, part & ~seeds);
    cv::Mat bench;
    cv::erode(~part, bench, cv::getStructuringElement(cv::MORPH_ELLIPSE, {3, 3}));
    markers.setTo(1, bench);
    cv::watershed(work, markers);
    cv::Mat labels = cv::Mat::zeros(work.size(), CV_16U);
    for (int y = 0; y < markers.rows; ++y) {
        const int* m = markers.ptr<int>(y);
        const uchar* p = part.ptr<uchar>(y);
        uint16_t* l = labels.ptr<uint16_t>(y);
        for (int x = 0; x < markers.cols; ++x)
            if (p[x] && m[x] > 1 && m[x] <= n) l[x] = uint16_t(m[x] - 1);
    }
    return labels;
}

std::vector<Group> groupParts(std::vector<Part>& parts, const Params& params) {
    // Mean shift on (log length, log diameter), scaled by the bandwidths: each
    // part climbs to the densest spot near it, and parts that end up at the
    // same spot are one type.
    std::vector<size_t> idx;
    std::vector<cv::Point2d> pts;
    for (size_t i = 0; i < parts.size(); ++i) {
        parts[i].group = -1;
        if (parts[i].unknown || parts[i].length <= 0 || parts[i].diameter <= 0) continue;
        idx.push_back(i);
        pts.emplace_back(std::log(parts[i].length) / params.lengthBandwidth,
                         std::log(parts[i].diameter) / params.diameterBandwidth);
    }
    std::vector<cv::Point2d> modes;
    std::vector<int> modeOf(pts.size(), -1);
    for (size_t i = 0; i < pts.size(); ++i) {
        cv::Point2d x = pts[i];
        for (int it = 0; it < 50; ++it) {
            cv::Point2d num(0, 0);
            double den = 0;
            for (const auto& p : pts) {
                cv::Point2d d = p - x;
                double w = std::exp(-0.5 * d.dot(d));
                num += w * p;
                den += w;
            }
            cv::Point2d nx = num / den;
            bool done = cv::norm(nx - x) < 1e-3;
            x = nx;
            if (done) break;
        }
        int found = -1;
        for (size_t m = 0; m < modes.size(); ++m)
            if (cv::norm(modes[m] - x) < 0.5) found = int(m);
        if (found < 0) {
            modes.push_back(x);
            found = int(modes.size()) - 1;
        }
        modeOf[i] = found;
    }

    // A type with a single part is usually a mismeasured one: it joins the
    // nearest type with more, if one is near enough.
    std::vector<int> members(modes.size(), 0);
    for (int m : modeOf) members[size_t(m)]++;
    for (size_t i = 0; i < pts.size(); ++i) {
        if (members[size_t(modeOf[i])] > 1) continue;
        int best = -1;
        double bd = 2.0;
        for (size_t m = 0; m < modes.size(); ++m)
            if (members[m] > 1 && cv::norm(modes[m] - pts[i]) < bd) {
                bd = cv::norm(modes[m] - pts[i]);
                best = int(m);
            }
        if (best >= 0) {
            members[size_t(modeOf[i])]--;
            modeOf[i] = best;
            members[size_t(best)]++;
        }
    }
    // Renumber, dropping types left empty. A part still alone is "?": with
    // largest first, one mismeasured part would otherwise lead the sort.
    std::vector<int> renum(modes.size(), -1);
    int kept = 0;
    for (size_t m = 0; m < modes.size(); ++m)
        if (members[m] > (params.keepSingles ? 0 : 1)) renum[m] = kept++;
    for (int& m : modeOf) m = renum[size_t(m)];
    modes.resize(size_t(kept));

    std::vector<Group> groups(modes.size());
    std::vector<std::vector<double>> L(modes.size()), Dm(modes.size()), H(modes.size());
    for (size_t i = 0; i < pts.size(); ++i) {
        if (modeOf[i] < 0) continue;
        const Part& p = parts[idx[i]];
        L[size_t(modeOf[i])].push_back(p.length);
        Dm[size_t(modeOf[i])].push_back(p.diameter);
        H[size_t(modeOf[i])].push_back(p.headWidth);
    }
    for (size_t g = 0; g < groups.size(); ++g) {
        groups[g].length = float(percentile(L[g], 0.5));
        groups[g].diameter = float(percentile(Dm[g], 0.5));
        groups[g].headWidth = float(percentile(H[g], 0.5));
        groups[g].count = groups[g].total = int(L[g].size());
    }
    // Largest first, by volume (length x diameter squared).
    std::vector<int> order(groups.size());
    std::iota(order.begin(), order.end(), 0);
    auto volume = [&](int g) { return double(groups[size_t(g)].length) * groups[size_t(g)].diameter * groups[size_t(g)].diameter; };
    std::sort(order.begin(), order.end(), [&](int a, int b) { return volume(a) > volume(b); });
    std::vector<int> rank(groups.size());
    std::vector<Group> sorted;
    for (size_t r = 0; r < order.size(); ++r) {
        rank[size_t(order[r])] = int(r);
        sorted.push_back(groups[size_t(order[r])]);
    }
    for (size_t i = 0; i < pts.size(); ++i) parts[idx[i]].group = modeOf[i] < 0 ? -1 : rank[size_t(modeOf[i])];
    return sorted;
}

Sorter::Sorter(Kind kind, Params params) : kind_(kind), params_(params) {}

Frame Sorter::scan(const cv::Mat& bgr) {
    auto t0 = std::chrono::steady_clock::now();
    cv::Mat work = prepare(bgr, params_);
    return lock(detect(work, kind_, params_), work.size(), t0);
}

Frame Sorter::process(const cv::Mat& bgr) {
    auto t0 = std::chrono::steady_clock::now();
    cv::Mat work = prepare(bgr, params_);
    return match(detect(work, kind_, params_), work.size(), t0);
}

Frame Sorter::scanMaps(const cv::Mat& work, const cv::Mat& fg, const cv::Mat& core) {
    auto t0 = std::chrono::steady_clock::now();
    return lock(detectFromLabels(work, labelsFromMaps(work, fg, core), kind_, params_), work.size(), t0);
}

Frame Sorter::checkMaps(const cv::Mat& work, const cv::Mat& fg, const cv::Mat& core) {
    auto t0 = std::chrono::steady_clock::now();
    return match(detectFromLabels(work, labelsFromMaps(work, fg, core), kind_, params_), work.size(), t0);
}

Frame Sorter::lock(Detection det, cv::Size size, std::chrono::steady_clock::time_point t0) {
    groups_ = groupParts(det.parts, params_);
    // Every grouped part, for matching later photos against.
    seen_.clear();
    for (const auto& p : det.parts)
        if (p.group >= 0) seen_.push_back({std::log(p.length), std::log(p.diameter), p.group});
    Frame f;
    f.parts = std::move(det.parts);
    f.groups = groups_;
    f.size = size;
    f.headPx = det.headPx;
    f.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    return f;
}

Frame Sorter::match(Detection det, cv::Size size, std::chrono::steady_clock::time_point t0) {
    Frame f;
    f.size = size;
    f.headPx = det.headPx;
    f.groups = groups_;
    for (auto& g : f.groups) g.count = 0;

    // A part is matched against the parts seen at the scan rather than the
    // groups' medians: a group can be lopsided, and the scan's own parts
    // reproduce where its edges were. Distances are in bandwidths, with the
    // photo's sizes divided by the scale s.
    const double bl = params_.lengthBandwidth, bd = params_.diameterBandwidth;
    auto nearest = [&](const Part& p, double s, int k, std::vector<std::pair<double, int>>& out) {
        const double l = std::log(p.length / s), d = std::log(p.diameter / s);
        out.clear();
        for (const auto& q : seen_) out.push_back({std::hypot((l - q.logLength) / bl, (d - q.logDiameter) / bd), q.group});
        const size_t n = std::min(out.size(), size_t(k));
        std::partial_sort(out.begin(), out.begin() + long(n), out.end());
        out.resize(n);
    };
    std::vector<std::pair<double, int>> near;

    // The scale that best fits what's in view to what was seen at the scan.
    double best = 1, bestCost = 1e300;
    if (!seen_.empty()) {
        for (double s = 0.6; s <= 1.6; s *= 1.01) {
            double cost = 0;
            for (const auto& p : det.parts) {
                if (p.unknown) continue;
                nearest(p, s, 1, near);
                cost += std::min(near[0].first * near[0].first, 9.0);
            }
            if (cost < bestCost) {
                bestCost = cost;
                best = s;
            }
        }
    }
    f.scale = best;

    // Each part goes with most of its five nearest, weighted by closeness;
    // nothing seen at the scan near it at all is "?".
    for (auto& p : det.parts) {
        p.group = -1;
        if (p.unknown || seen_.empty()) continue;
        nearest(p, best, 5, near);
        if (near[0].first > params_.unknownDistance) continue;
        std::vector<double> votes(groups_.size(), 0.0);
        for (const auto& [dist, g] : near) votes[size_t(g)] += 1.0 / (0.25 + dist);
        p.group = int(std::max_element(votes.begin(), votes.end()) - votes.begin());
        f.groups[size_t(p.group)].count++;
    }
    f.parts = std::move(det.parts);
    f.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    return f;
}

cv::Scalar groupColor(int index) {
    // Okabe-Ito (less its yellow, which is "?"), then Tol's muted set.
    static const cv::Scalar colors[] = {
        {0, 159, 230},   {233, 180, 86},  {115, 158, 0},  {178, 114, 0},   {0, 94, 213},    {167, 121, 204},
        {153, 204, 136}, {153, 170, 68},  {85, 34, 136},  {51, 153, 153},  {51, 119, 17},   {153, 68, 170},
    };
    const int n = int(sizeof(colors) / sizeof(colors[0]));
    return colors[((index % n) + n) % n];
}

cv::Scalar unknownColor() { return {66, 228, 240}; }

}  // namespace sorter
