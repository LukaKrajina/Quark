/****************************************************************************
** Meta object code from reading C++ file 'vulkan_viewport.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.2)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../../../quarkRSP/gui/qt/vulkan_viewport.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'vulkan_viewport.h' doesn't include <QObject>."
#elif Q_MOC_OUTPUT_REVISION != 69
#error "This file was generated using the moc from 6.11.2. It"
#error "cannot be used with the include files from this version of Qt."
#error "(The moc has changed too much.)"
#endif

#ifndef Q_CONSTINIT
#define Q_CONSTINIT
#endif

QT_WARNING_PUSH
QT_WARNING_DISABLE_DEPRECATED
QT_WARNING_DISABLE_GCC("-Wuseless-cast")
namespace {
struct qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t {};
} // unnamed namespace

template <> constexpr inline auto quarkrsp::gui::QVulkanViewport::qt_create_metaobjectdata<qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "quarkrsp::gui::QVulkanViewport",
        "dragDelta",
        "",
        "dx",
        "dy"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'dragDelta'
        QtMocHelpers::SignalData<void(float, float)>(1, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Float, 3 }, { QMetaType::Float, 4 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<QVulkanViewport, qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject quarkrsp::gui::QVulkanViewport::staticMetaObject = { {
    QMetaObject::SuperData::link<QVulkanWindow::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t>.metaTypes,
    nullptr
} };

void quarkrsp::gui::QVulkanViewport::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<QVulkanViewport *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->dragDelta((*reinterpret_cast<std::add_pointer_t<float>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<float>>(_a[2]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (QVulkanViewport::*)(float , float )>(_a, &QVulkanViewport::dragDelta, 0))
            return;
    }
}

const QMetaObject *quarkrsp::gui::QVulkanViewport::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *quarkrsp::gui::QVulkanViewport::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN8quarkrsp3gui15QVulkanViewportE_t>.strings))
        return static_cast<void*>(this);
    return QVulkanWindow::qt_metacast(_clname);
}

int quarkrsp::gui::QVulkanViewport::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QVulkanWindow::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 1)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 1;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 1)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 1;
    }
    return _id;
}

// SIGNAL 0
void quarkrsp::gui::QVulkanViewport::dragDelta(float _t1, float _t2)
{
    QMetaObject::activate<void>(this, &staticMetaObject, 0, nullptr, _t1, _t2);
}
QT_WARNING_POP
